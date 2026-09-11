/** Read-only numbers the globe reports back for the status bar. */
class Status {
  ready = $state(false);
  error = $state<string | null>(null);
  loadMessage = $state('Starting renderer');

  fps = $state(0);
  gmstRad = $state(0);
  subsolarLatDeg = $state(0);
  subsolarLonDeg = $state(0);
  sunDeclinationDeg = $state(0);
  cameraAltitudeKm = $state(0);
  cameraLatDeg = $state(0);
  cameraLonDeg = $state(0);
  starCount = $state(0);
}

export const status = new Status();
