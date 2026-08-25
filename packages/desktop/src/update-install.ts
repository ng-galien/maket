interface UpdateInstallationOptions {
  prepareInstall: () => () => void;
  stopRuntime: () => Promise<void>;
  startRuntime: () => Promise<void>;
  setQuitting: (quitting: boolean) => void;
}

export async function installDesktopUpdate({
  prepareInstall,
  stopRuntime,
  startRuntime,
  setQuitting,
}: UpdateInstallationOptions): Promise<void> {
  const install = prepareInstall();
  let runtimeStopped = false;
  setQuitting(true);
  try {
    await stopRuntime();
    runtimeStopped = true;
    install();
  } catch (error) {
    setQuitting(false);
    if (runtimeStopped) {
      try {
        await startRuntime();
      } catch (restartError) {
        throw new AggregateError(
          [error, restartError],
          "The update could not be installed and the Maket server could not be restarted",
        );
      }
    }
    throw error;
  }
}
