declare module "@tensorflow/tfjs" {
  export function loadLayersModel(url: string): Promise<unknown>;
  export function tidy<T>(fn: () => T): T;
  export function zeros(shape: number[]): unknown;
  export function tensor4d(values: unknown, shape: number[]): unknown;
}
