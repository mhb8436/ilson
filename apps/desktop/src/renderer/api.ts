import type { IlsonApi } from "../shared/api";

declare global {
  interface Window {
    ilson: IlsonApi;
  }
}

export const api: IlsonApi = window.ilson;

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
