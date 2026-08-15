# Desktop Gamepad Input Handoff For Stickvania And Jackal

Date: 2026-08-15

This note summarizes what was learned while fixing Java desktop gamepad input in the Ms. Pac-Man 2010 desktop build. The findings may apply to other Java desktop ports that use old Slick2D/LWJGL 2/JInput, including Stickvania and Jackal desktop versions.

## Scope

This is about the Java desktop version only.

The PWA/browser version did not have the same problems because the browser Gamepad API normalizes a lot of HID/controller behavior before the app sees it. Old LWJGL 2/JInput exposes much rawer Windows controller data.

## Symptoms Seen

- Some gamepads worked only with one analog stick.
- Some gamepads did not respond to the d-pad.
- One d-pad direction was interpreted as the wrong direction.
- After moving a stick, the app could get stuck in a direction such as down.
- Some non-direction gamepad buttons were not interpreted as Start/Pause.
- Turning off a gamepad could repeatedly print messages like:

```text
Failed to poll device: Failed to poll device (8007000c)
Failed to poll device: Failed to get device state (8007001e)
```

## What The Diagnostics Showed

In one failing controller, JInput exposed the d-pad as normal axes, not as buttons or a POV/hat:

```text
controller name='Bluetooth Wireless Controller'
axis[2] name='Y Axis' id='y'
axis[3] name='X Axis' id='x'
```

Pressing the d-pad moved those axes:

```text
Y Axis: -1.0, near 0, 1.0
X Axis: -1.0, near 0, 1.0
```

However, initial device reads sometimes reported all axes as `-1.0` before settling near neutral. A baseline/subtraction approach treated that bad first read as the center, which later made neutral look like positive movement. That caused false `DOWN` and `RIGHT` states.

Another device was not a gamepad at all:

```text
controller name='Razer BlackShark V2 X USB'
button[0] name='Volume Decrement'
button[1] name='Volume Increment'
axis[0] name='Axis 6'
axis[1] name='Axis 7'
axis[2] name='Axis 8'
```

JInput still exposed it as a controller-like device, so the app needed to filter media/volume-only devices.

Some trigger-like axes had misleading identifiers:

```text
axis name='Accelerator' id='y'
axis name='Brake' id='rz'
```

This means component id alone is not safe. The axis name must also be checked so trigger/brake/accelerator/media axes are not treated as movement.

## Root Causes

1. Old JInput does not normalize controllers like the browser Gamepad API does.
2. A d-pad may appear as buttons, POV/hat, or ordinary axes.
3. Initial axis readings can be bogus, often `-1.0`.
4. Baseline correction can convert neutral axis values into false movement.
5. Non-game HID devices can appear as controllers.
6. Trigger axes can have misleading ids such as `y` or `rz`.
7. JInput can write native poll failures directly to stdout/stderr when a gamepad disconnects.

## Fix Pattern Used In Ms. Pac-Man

Reference implementation:

- `desktop/src/mspacman/HumanInput.java`
- `desktop/src/mspacman/Main.java`
- `desktop/src/mspacman/AppletGameContainer2.java`

### 1. Disable Slick's Built-In Controller Path

The desktop app now disables Slick's own controller polling and uses a custom JInput/LWJGL path instead.

In startup paths, call:

```java
HumanInput.installJInputPollFailureFilter();
Input.disableControllers();
```

This avoids double polling and avoids depending on Slick's old controller abstraction for gamepad behavior.

### 2. Treat Controller Polling As Best Effort

Controller creation and polling should never prevent keyboard play or game startup.

If `Controllers.create()` or `Controllers.poll()` fails, silently mark controller input unavailable and continue. Do not keep retrying every frame after a native poll failure.

### 3. Support Three Direction Sources

Check all of these for directions:

- POV/hat values.
- Directional d-pad buttons.
- Directional axes.

Do not assume one layout.

### 4. Do Not Use Axis Baseline Correction

The baseline approach caused the worst bug.

Bad pattern:

```java
adjusted = currentValue - firstObservedValue;
```

If the first observed value is a bogus `-1.0`, neutral later becomes about `+1.0`, which looks like down/right.

Use raw axis values with a deadzone instead:

```java
if (Math.abs(value) <= AXIS_RECENTER_THRESHOLD) {
    return 0f;
}
return value;
```

### 5. Classify Directional Axes Conservatively

Only use axes that look like true stick/d-pad movement axes.

Accepted examples:

- id/name `x`
- id/name `y`
- id/name `rx`
- id/name `ry`
- names like `X Axis` and `Y Axis`

Rejected examples:

- `accelerator`
- `accel`
- `brake`
- `trigger`
- `throttle`
- `slider`
- `volume`

Important: check both the JInput component id and the human-readable axis name. An `Accelerator` axis may report id `y`; name rejection must win.

### 6. Filter Non-Game Devices

Skip obvious non-game controller names:

- keyboard
- mouse
- consumer control
- system controller

Also skip volume/media-only controllers. A practical rule:

- If a controller has buttons, and every button name is media/volume/mute related, ignore the controller.

This prevented a headset volume device from creating phantom directions.

### 7. Treat Non-Directional Buttons As Start/Pause

For parity with the PWA behavior:

- Directional gamepad controls move.
- Any non-directional gamepad button acts as Start on menu/name-entry screens.
- Any non-directional gamepad button can act as Start/Pause during gameplay if the project wants NES-style Start/Pause behavior.

The exact mapping should match each game's current input interface, but do not depend only on one specific button number.

### 8. Suppress JInput Poll Failure Console Spam

JInput may print directly to stdout/stderr on disconnect. The Ms. Pac-Man desktop version wraps `System.out` and `System.err` with a small filtering stream that suppresses known JInput poll failure lines.

Suppress lines starting with:

```text
Failed to poll device:
```

Also suppress poll-component lines that contain either:

```text
Failed to poll device
Failed to get device state
```

When such a line is suppressed, mark controller input unavailable so the app stops polling the disconnected/bad device.

Do not suppress unrelated stdout/stderr output.

### 9. Remove Temporary Diagnostics Before Release

The Ms. Pac-Man debugging pass temporarily logged controller layouts, button transitions, axis values, POV states, and direction state changes to `desktop/input-diagnostics.log`.

That diagnostic pathway was useful to identify the HID layout, but it was removed before release. Production should keep only the compatibility fixes and the poll-error suppression.

If another project needs the same debugging pass, add diagnostics temporarily, collect the controller layout, then remove the hook once fixed.

## Why The PWA Version Worked Without This

The browser Gamepad API usually exposes a normalized `Gamepad` object:

- Standard d-pad buttons often map to `12`, `13`, `14`, `15`.
- Stick axes usually center near `0`.
- Browser/controller mapping layers hide many raw HID quirks.

LWJGL 2/JInput on Windows can expose:

- The same physical controller as multiple devices.
- D-pad as axes, buttons, or POV depending on the driver/device.
- Non-game HID devices as controllers.
- Bogus initial axis values.
- Native poll errors printed directly to the console.

So the desktop version needs a compatibility layer that the browser version does not.

## Recommended Audit For Stickvania Or Jackal Desktop

Check whether the desktop input code:

1. Uses Slick's built-in controller support directly.
2. Assumes d-pad buttons only.
3. Assumes POV/hat only.
4. Uses first-read axis baselines.
5. Treats all axes as movement axes.
6. Treats media/volume devices as gamepads.
7. Polls forever after a disconnect failure.
8. Lets JInput poll failures spam stdout/stderr.
9. Requires one hard-coded Start button instead of accepting any non-directional gamepad button.

If any are true, apply the fix pattern above.

## Expected Production Behavior

- Keyboard still works even if gamepad support fails.
- The game starts without a gamepad.
- D-pad works whether exposed as buttons, POV, or X/Y axes.
- Sticks work on true X/Y or RX/RY axes.
- Trigger/brake/accelerator/media axes do not move the player.
- Media/volume HID devices are ignored.
- Any non-directional gamepad button can be Start/Pause if the game wants that behavior.
- Turning off a controller does not spam the console.
- No diagnostic log file is produced in production.
