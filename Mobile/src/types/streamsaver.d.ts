declare module "streamsaver" {
  interface WritableStreamOptions {
    size?: number;
  }

  function createWriteStream(
    filename: string,
    options?: WritableStreamOptions
  ): WritableStream<Uint8Array>;

  export { createWriteStream };
}
