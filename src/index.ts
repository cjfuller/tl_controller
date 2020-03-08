import net from "net";

import SerialPort from "serialport";

import { Response, SetIntensity, SetShutter, Command } from "./commands";
import * as store from "./store";

let _port: SerialPort | null = null;
let _parser: any | null = null;
let _responseQueue: string[] = [];

async function waitForResponse(
  maxWait_ms: number,
  interval_ms: number = 10,
): Promise<string> {
  if (_responseQueue.length > 0) {
    return _responseQueue.shift() || "";
  }
  if (maxWait_ms <= 0) {
    throw new Error("timeout");
  }
  return await new Promise(resolve => {
    setTimeout(() => {
      waitForResponse(maxWait_ms - interval_ms, interval_ms).then(resolve);
    }, interval_ms);
  });
}

async function writeToPort(message: string): Promise<string> {
  if (_port === null) {
    throw new Error("Trying to write to uninitialized port.");
  }
  console.log(`Sending "${message}" to microscope.`);
  const result = await new Promise(resolve =>
    _port?.write(message + "\r", resolve),
  );
  if (result) {
    throw new Error(result as any);
  }
  const response = await waitForResponse(1000);
  console.log(`Received "${response}" from microscope.`);
  return response;
}

async function initialize(): Promise<Response> {
  // TODO(colin): use a proper result monad in this function, or just leverage
  // promise error handling.
  console.log("Initializing");
  if (_port === null) {
    _port = new SerialPort("COM4", {
      baudRate: 19200,
      dataBits: 8,
      parity: "none",
      stopBits: 1,
      xon: true,
      xoff: true,
    });
    _parser = new SerialPort.parsers.Delimiter({ delimiter: "\r" });
    _port.pipe(_parser);
    _parser.on("data", (d: Buffer) => _responseQueue.push(d.toString("ascii")));
  }
  // Set the active lamp to the be TL lamp.
  const response = await writeToPort("77025 0");
  if (response !== "77025") {
    console.log(`Got unespected response "${response}" from microscope.`);
    return "ERROR";
  }

  // Turn off manual control. We have no mechanism for syncing back manual
  // adjustments to micro-manager, so we disable it to be safe.
  const manualResponse = await writeToPort("77005 0");
  if (manualResponse !== "77005") {
    console.log(`Got unexpected response "${manualResponse}" from microscope.`);
    return "ERROR";
  }

  // Set the intensity to 0.
  const intensityResp = await writeToPort("77020 0 0");
  if (intensityResp !== "77020") {
    console.log(`Got unespected response "${intensityResp}" from microscope.`);
    return "ERROR";
  }

  // Open the "shutter". There's not a physical shutter on this scope, and I'm
  // pretty sure there's a bug in the shutter control mechanism in the scope
  // that makes it start to error after you toggle it enough. Thus, we'll leave
  // the shutter open once, and do the "shuttering" via setting the intensity
  // once, which is what the scope would do anyway absent a physical shutter.
  const shutterResp = await writeToPort("77032 0 1");
  if (shutterResp !== "77032") {
    console.log(`Got unespected response "${shutterResp}" from microscope.`);
    return "ERROR";
  }

  return await syncMicroscopeToState();
}

async function shutdown(): Promise<Response> {
  console.log("Shutting down.");
  if (_port !== null) {
    // Reenable manual control of the TL lamp.
    const manualResponse = await writeToPort("77005 1");
    if (manualResponse !== "77005") {
      console.log(
        `Got unexpected response "${manualResponse}" from microscope.`,
      );
      return "ERROR";
    }
  }
  _port = null;
  return "OK";
}

async function setIntensity(command: SetIntensity): Promise<Response> {
  console.log(`Setting intensity to ${command.level}`);
  store.setIntensity(command);
  return "OK";
}

async function setShutterState(command: SetShutter): Promise<Response> {
  console.log(`Setting shutter open to: ${command.state}`);
  store.setShutter(command);
  return "OK";
}

async function syncMicroscopeToState(): Promise<Response> {
  const state = store.getState();
  console.log(`Syncing; state is: ${JSON.stringify(state)}`);
  if (state.shutterOpen) {
    const resp = await writeToPort(`77020 ${state.intensity} 0`);
    if (resp !== "77020") {
      console.log(`Got unexpected response "${resp}" from microscope.`);
      return "ERROR";
    }
    return "OK";
  } else {
    const resp = await writeToPort(`77020 0 0`);
    if (resp !== "77020") {
      console.log(`Got unexpected response" ${resp}" from microscope.`);
      return "ERROR";
    }
    return "OK";
  }
}

async function executeCommand(command: Command): Promise<Response> {
  let result: Response = "ERROR";
  switch (command.type) {
    case "SHUTDOWN":
      result = await shutdown();
      return result;
    case "INITIALIZE":
      result = await initialize();
      break;
    case "TL_INTENSITY":
      result = await setIntensity(command);
      break;
    case "SHUTTER_OPEN":
      result = await setShutterState(command);
      break;
    default:
      throw new Error(`Got unknown command ${command}`);
  }
  const syncResult = await syncMicroscopeToState();
  return syncResult === "ERROR" ? syncResult : result;
}

function parseCommand(textCommand: string): Command | "ERROR" {
  if (!textCommand.endsWith("\n")) {
    console.log("Command didn't end in a line feed; don't know how to handle.");
    return "ERROR";
  }
  const [prefix, ...args] = textCommand.trim().split(" ");
  switch (prefix) {
    case "SHUTDOWN":
      return { type: "SHUTDOWN" };
    case "INITIALIZE":
      return { type: "INITIALIZE" };
    case "TL_INTENSITY": {
      if (args.length != 1) {
        console.log("Could not parse intensity args.");
        return "ERROR";
      }
      const intensity = Number.parseInt(args[0], 10);
      if (Number.isNaN(intensity)) {
        console.log("Intensity was not a numeric value.");
        return "ERROR";
      }
      if (intensity < 0 || intensity > 255) {
        console.log("Intenisty was not in the range [0, 255]");
        return "ERROR";
      }
      return { type: "TL_INTENSITY", level: intensity };
    }
    case "SHUTTER_OPEN": {
      if (args.length != 1) {
        console.log("Could not parse shutter args.");
        return "ERROR";
      }
      if (args[0] === "0") {
        return { type: "SHUTTER_OPEN", state: false };
      }
      if (args[0] === "1") {
        return { type: "SHUTTER_OPEN", state: true };
      }
      console.log("Unknown shutter state; expected 0/1.");
      return "ERROR";
    }
    default: {
      console.log("Unknown or malformed command.");
      return "ERROR";
    }
  }
}

async function handleRequest(data: string): Promise<Response> {
  console.log(`Received command: "${data.trim()}"`);
  const parsed = parseCommand(data);
  if (parsed === "ERROR") {
    return "ERROR";
  }
  return await executeCommand(parsed);
}

const server = net.createServer(c => {
  c.setEncoding("ascii");
  console.log("Micromanager connected");
  c.on("end", () => {
    console.log("Micromanager disconnected");
  });
  c.on("data", data => {
    handleRequest(data.toString("ascii")).then(r => c.write(r + "\n"));
  });
});

server.on("error", err => {
  console.log(`Got error: "${err}"`);
});

const port = 31104;

server.listen(port, () => {
  console.log(`Listening on port ${port}`);
});
