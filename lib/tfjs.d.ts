declare module "@tensorflow/tfjs" {
  export function loadLayersModel(url: string): Promise<any>;
  export function tidy<T>(fn: () => T): T;
  export function zeros(shape: number[]): any;
  export function tensor4d(values: any, shape: number[]): any;
}
