import "reflect-metadata";
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

const PERMISSION_KEY = Symbol("permissions");

export function Restrict(permission?: Permission): PropertyDecorator {
  return (target: Object, propertyKey: string | symbol) => {
    const permissions = Reflect.getMetadata(PERMISSION_KEY, target) || {};
    permissions[propertyKey as string] = permission;
    Reflect.defineMetadata(PERMISSION_KEY, permissions, target);
  };
}

export class Store implements IStore {
  defaultPolicy: Permission = "rw";

  allowedToRead(key: string): boolean {
    const permission = this.getPermission(key);
    return permission === "r" || permission === "rw";
  }

  allowedToWrite(key: string): boolean {
    const permission = this.getPermission(key);
    return permission === "w" || permission === "rw";
  }

  read(path: string): StoreResult {
    const [key, subPath] = this.computePath(path);

    if (!subPath.length) return this.readThisStore(key);

    return this.readNestedStore(subPath, key);
  }

  write(path: string, value: StoreValue): StoreValue {
    const [key, subPath] = this.computePath(path);

    if (!subPath.length) this.addToThisStore(key, value);
    else this.addToNestedStore(key, subPath, value);

    return value;
  }

  writeEntries(entries: JSONObject): void {
    for (const [key, val] of Object.entries(entries)) {
      this.write(key, val);
    }
  }

  entries(): JSONObject {
    const entries: JSONObject = {};
    for (const [key, val] of Object.entries(this)) {
      if (key !== "defaultPolicy" && this.allowedToRead(key)) {
        entries[key] = val;
      }
    }
    return entries;
  }

  private getPermission(key: string): Permission {
    const permissions = Reflect.getMetadata(PERMISSION_KEY, this) || {};
    return permissions[key] || this.defaultPolicy;
  }

  private readThisStore(key: string): StoreResult {
    if (!this.allowedToRead(key))
      throw Error(`read operation not allowed for key ${key}`);

    const value = this.getAttribute(key);

    if (typeof value === "function") return value();
    return value as StoreResult;
  }

  private readNestedStore(subPath: string, key: string): StoreResult {
    const value = this[key as keyof this];
    const subStore: Store = typeof value === "function" ? value() : value;
    return subStore.read(subPath);
  }

  private addToThisStore(key: string, value: StoreValue) {
    if (!this.allowedToWrite(key))
      throw Error(`write operation not allowed for key: ${key}`);

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
}
