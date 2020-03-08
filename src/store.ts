import { SetShutter, SetIntensity } from "./commands";

export type State = {
  readonly shutterOpen: boolean;
  readonly intensity: number;
};

let _state: State = {
  shutterOpen: false,
  intensity: 0,
};

export function getState(): State {
  return { ..._state };
}

export function setShutter(command: SetShutter) {
  _state = { ..._state, shutterOpen: command.state };
}

export function setIntensity(command: SetIntensity) {
  _state = { ..._state, intensity: command.level };
}
