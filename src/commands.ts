export type CommandPrefix =
  | "INITIALIZE"
  | "SHUTTER_OPEN"
  | "TL_INTENSITY"
  | "SHUTDOWN";

export type SetIntensity = {
  readonly type: "TL_INTENSITY";
  readonly level: number;
};
export type SetShutter = {
  readonly type: "SHUTTER_OPEN";
  readonly state: boolean;
};

export type Command =
  | { readonly type: "INITIALIZE" }
  | { readonly type: "SHUTDOWN" }
  | SetIntensity
  | SetShutter;

export type Response = "OK" | "ERROR";
