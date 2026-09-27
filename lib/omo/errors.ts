export class OmoBinaryError extends Error {
  readonly name = "OmoBinaryError";

  constructor(readonly stderr: string) {
    super(
      stderr
        ? `Unable to verify the omo binary: ${stderr}`
        : "Unable to verify the omo binary",
    );
  }
}

export class OmoUnsupportedPlatformError extends Error {
  readonly name = "OmoUnsupportedPlatformError";

  constructor() {
    super("OmO Native requires a POSIX platform with Unix socket support");
  }
}
