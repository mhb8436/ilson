import { contextBridge, ipcRenderer } from "electron";
import { API_METHODS, type IlsonApi, type IpcResult } from "../shared/api.js";

const api = Object.fromEntries(
  API_METHODS.map((name) => [
    name,
    async (...args: unknown[]) => {
      const res = (await ipcRenderer.invoke(`ilson:${name}`, ...args)) as IpcResult<unknown>;
      if (!res.ok) throw new Error(res.error);
      return res.data;
    },
  ]),
) as unknown as IlsonApi;

contextBridge.exposeInMainWorld("ilson", api);
