import {
  createJSONStorage,
  type PersistStorage,
  type StorageValue,
} from "zustand/middleware";
import { shallow } from "zustand/shallow";

export function createUnchangedPersistStorage<State>():
  | PersistStorage<State>
  | undefined {
  const storage = createJSONStorage<State>(() => localStorage);
  if (!storage) return undefined;
  let previous: StorageValue<State> | undefined;
  return {
    getItem: (name) => {
      previous = undefined;
      return storage.getItem(name);
    },
    setItem: (name, value) => {
      if (
        previous?.version === value.version &&
        shallow(previous?.state, value.state)
      )
        return;
      const result = storage.setItem(name, value);
      previous = value;
      return result;
    },
    removeItem: (name) => {
      previous = undefined;
      return storage.removeItem(name);
    },
  };
}
