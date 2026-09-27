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

export class OmoIncompatibleHostError extends Error {
  readonly name = "OmoIncompatibleHostError";

  constructor(readonly protocolInfo: unknown) {
    super("Connected OmO host does not support the required RPC protocol");
  }
}

export class OmoCommandError extends Error {
  readonly name = "OmoCommandError";

  constructor(
    readonly command: string,
    readonly error: string,
    readonly errorCode: string | undefined,
    readonly errorData: unknown,
  ) {
    super(
      errorCode
        ? `OmO command ${command} failed (${errorCode}): ${error}`
        : `OmO command ${command} failed: ${error}`,
    );
  }
}

export class OmoOpenInFlightError extends Error {
  readonly name = "OmoOpenInFlightError";

  constructor() {
    super("An OmO open_session request is already in flight");
  }
}

export class OmoDaemonUsageError extends Error {
  readonly name = "OmoDaemonUsageError";

  constructor() {
    super("The omo daemon command rejected its arguments");
  }
}

export class OmoDaemonNotRunningError extends Error {
  readonly name = "OmoDaemonNotRunningError";

  constructor() {
    super("The omo daemon is not running");
  }
}

export class OmoEngineRefusedError extends Error {
  readonly name = "OmoEngineRefusedError";

  constructor(readonly stderr: string) {
    super(
      stderr
        ? `The omo engine refused to start: ${stderr}`
        : "The omo engine refused to start",
    );
  }
}
