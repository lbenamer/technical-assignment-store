import { JSONArray, JSONObject, JSONPrimitive } from "./json-types";

export type Permission = "r" | "w" | "rw" | "none";

export type StoreResult = Store | JSONPrimitive | undefined;

export type StoreValue =
  | JSONObject
  | JSONArray
  | StoreResult
  | (() => StoreResult);

export interface IStore {
  defaultPolicy: Permission;
  allowedToRead(key: string): boolean;
  allowedToWrite(key: string): boolean;
  read(path: string): StoreResult;
  write(path: string, value: StoreValue): StoreValue;
  writeEntries(entries: JSONObject): void;
  entries(): JSONObject;
}

type PermissionObject = {
  [key: string]: {
    [key: string]: Permission;
  };
};
class PermissionStore {
  private permissions: PermissionObject = {};

  add(storeName: string, key: string, permission: Permission) {
    if (!(storeName in this.permissions)) this.permissions[storeName] = {};
    this.permissions[storeName][key] = permission;
  }

  read(storeName: string, key: string): Permission | undefined {
    if (this.permissions[storeName]) return this.permissions[storeName][key];
    return undefined;
  }
}

const permissionStore = new PermissionStore();

export function Restrict(permission?: Permission): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const storeName = target.constructor.name;
    if (permission)
      permissionStore.add(storeName, propertyKey as string, permission);
  };
}

export class Store implements IStore {
  defaultPolicy: Permission = "rw";

  getPermission(key: string): Permission {
    const storeName = this.constructor.name;
    return permissionStore.read(storeName, key) || this.defaultPolicy;
  }

  allowedToRead(key: string): boolean {
    const permission = this.getPermission(key);
    return permission == "r" || permission == "rw";
  }

  allowedToWrite(key: string): boolean {
    const permission = this.getPermission(key);
    return permission == "w" || permission == "rw";
  }

  read(path: string): StoreResult {
    const [key, subPath] = this.computePath(path);

    if (!subPath.length) {
      if (!this.allowedToRead(key as string)) {
        throw Error("read operation not allowed");
      }
      const value = this[key as keyof this];
      if (typeof value === "function") {
        return value();
      }
      return value as StoreResult;
    } else {
      const value = this[key as keyof this];
      const subStore: Store = typeof value === "function" ? value() : value;
      return subStore.read(subPath);
    }
  }

  write(path: string, value: StoreValue): StoreValue {
    const [key, subPath] = this.computePath(path);

    if (!subPath.length) {
      this.addToThisStore(key, value);
    } else {
      this.addToNestedStore(key, subPath, value);
    }
    return value;
  }

  private addToThisStore(key: string, value: StoreValue) {
    if (!this.allowedToWrite(key)) {
      throw Error(`write operation not allowed for key: ${key}`);
    }
    if (typeof value === "object") {
      const subStore = new Store();
      for (const [key, val] of Object.entries(value as JSONObject)) {
        subStore.write(key, val);
      }
      this.setAttribute(key, subStore);
    } else {
      this.setAttribute(key, value);
    }
  }

  private addToNestedStore(key: string, subPath: string, value: StoreValue) {
    if (!this.getAttribute(key)) {
      if (!this.allowedToWrite(key)) {
        throw Error(`write operation not allowed for key: ${key}`);
      }
      const subStore = new Store();
      subStore.write(subPath, value);
      this.setAttribute(key, subStore);
    } else {
      const subStore = this.getAttribute(key) as Store;
      subStore.write(subPath, value);
    }
  }

  private computePath(path: string): string[] {
    const keys = path.split(":");
    const key = keys.shift();
    if (!key) {
      throw Error("empty path not allowed");
    }
    const subPath = keys.join(":");
    return [key, subPath];
  }

  private setAttribute(key: string, value: StoreValue) {
    Object.defineProperty(this, key, {
      value,
      enumerable: true,
      writable: true,
    });
  }

  private getAttribute(key: string): StoreValue {
    return this[key as keyof this] as StoreValue;
  }

  writeEntries(entries: JSONObject): void {
    for (const [key, val] of Object.entries(entries)) {
      this.write(key, val);
    }
  }

  entries(): JSONObject {
    const response: JSONObject = {};
    for (const [key, val] of Object.entries(this)) {
      if (key !== "defaultPolicy" && this.allowedToRead(key)) {
        response[key] = val;
      }
    }
    return response;
  }
}
