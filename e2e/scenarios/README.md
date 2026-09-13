# Offline World scenarios

`createOfflineScenario` from `e2e/offlineScenario.ts` supplies the shared Electron
harness with a disposable pre-main entrypoint and a renderer clock callback.
Use `world-darvo` for a fixed deal, `world-loading` to hold its response until
`scenario.releaseWorld(harness.app)`, or `world-unavailable` for failed DE and
oracle sources. Call `scenario.assertNoUnexpectedRequests()` after each test,
then close the harness before `scenario.dispose()`.

The World response uses raw DE fields and runs through production parsing and
IPC. Both clocks are fixed at 2026-09-13 12:00 UTC while timers keep running.
The scenario intercepts global main-process fetch and HTTP(S) in Electron's
default session before application startup. Undeclared requests receive HTTP
599 and fail the explicit request assertion. WFM item loading has an empty
transport fixture to avoid its Node HTTPS fallback.

Known unrelated startup services explicitly return unavailable responses;
remote images and fonts are unavailable too. Local packaged catalog data still
loads normally. These scenarios suit layout, loading and error handling, not
image baselines, populated market journeys or online service acceptance. They
do not intercept arbitrary Node HTTPS/socket calls, WebSockets or additional
Electron sessions. Add interceptors when a test uses those transports.
