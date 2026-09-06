package mspacman;

import org.lwjgl.input.*;
import org.newdawn.slick.*;
import java.io.*;
import java.lang.reflect.*;
import java.util.*;

public class HumanInput implements IInput {

  private static final int CONTROLLER_INDEX_LIMIT = 16;
  private static final int GAMEPAD_BUTTON_INDEX_LIMIT = 64;
  private static final int GAMEPAD_AXIS_LIMIT = 16;
  private static final int NAMED_X_AXIS_SLOT = GAMEPAD_AXIS_LIMIT;
  private static final int NAMED_Y_AXIS_SLOT = GAMEPAD_AXIS_LIMIT + 1;
  private static final int NAMED_RX_AXIS_SLOT = GAMEPAD_AXIS_LIMIT + 3;
  private static final int NAMED_RY_AXIS_SLOT = GAMEPAD_AXIS_LIMIT + 4;
  private static final float AXIS_THRESHOLD = 0.5f;
  private static final float AXIS_RECENTER_THRESHOLD = 0.05f;
  private static final Object POLL_LOG_FILTER_LOCK = new Object();
  private static final int STANDARD_DPAD_UP = 12;
  private static final int STANDARD_DPAD_DOWN = 13;
  private static final int STANDARD_DPAD_LEFT = 14;
  private static final int STANDARD_DPAD_RIGHT = 15;
  private static boolean jinputReflectionInitialized = false;
  private static Field jinputAxesField;
  private static Field jinputButtonsField;
  private static Field jinputPovField;
  private static Field jinputXAxisField;
  private static Field jinputYAxisField;
  private static Field jinputRXAxisField;
  private static Field jinputRYAxisField;
  private static boolean globalPollFailureFilterInstalled = false;
  private static volatile boolean globalPollFailureDetected = false;
  private static final int[] UP_KEYS = {
      Input.KEY_UP,
      Input.KEY_W,
      Input.KEY_I,
      Input.KEY_8,
      Input.KEY_NUMPAD8
  };

  private static final int[] DOWN_KEYS = {
      Input.KEY_DOWN,
      Input.KEY_S,
      Input.KEY_K,
      Input.KEY_2,
      Input.KEY_NUMPAD2
  };

  private static final int[] LEFT_KEYS = {
      Input.KEY_LEFT,
      Input.KEY_A,
      Input.KEY_J,
      Input.KEY_4,
      Input.KEY_NUMPAD4
  };

  private static final int[] RIGHT_KEYS = {
      Input.KEY_RIGHT,
      Input.KEY_D,
      Input.KEY_L,
      Input.KEY_6,
      Input.KEY_NUMPAD6
  };

  private static final int[] CONFIRM_START_KEYS = {
      Input.KEY_ENTER,
      Input.KEY_NUMPADENTER,
      Input.KEY_Q,
      Input.KEY_E,
      Input.KEY_R,
      Input.KEY_T,
      Input.KEY_Y,
      Input.KEY_U,
      Input.KEY_O,
      Input.KEY_F,
      Input.KEY_G,
      Input.KEY_H,
      Input.KEY_Z,
      Input.KEY_X,
      Input.KEY_C,
      Input.KEY_V,
      Input.KEY_B,
      Input.KEY_N,
      Input.KEY_M,
      Input.KEY_0,
      Input.KEY_1,
      Input.KEY_3,
      Input.KEY_5,
      Input.KEY_7,
      Input.KEY_9,
      Input.KEY_NUMPAD0,
      Input.KEY_NUMPAD1,
      Input.KEY_NUMPAD3,
      Input.KEY_NUMPAD5,
      Input.KEY_NUMPAD7,
      Input.KEY_NUMPAD9,
      Input.KEY_MINUS,
      Input.KEY_EQUALS,
      Input.KEY_LBRACKET,
      Input.KEY_RBRACKET,
      Input.KEY_SEMICOLON,
      Input.KEY_APOSTROPHE,
      Input.KEY_GRAVE,
      Input.KEY_BACKSLASH,
      Input.KEY_COMMA,
      Input.KEY_PERIOD,
      Input.KEY_SLASH,
      Input.KEY_MULTIPLY,
      Input.KEY_SUBTRACT,
      Input.KEY_ADD,
      Input.KEY_DECIMAL,
      Input.KEY_NUMPADEQUALS,
      Input.KEY_NUMPADCOMMA,
      Input.KEY_DIVIDE
  };

  private static final int[] MENU_START_KEYS = concat(
      CONFIRM_START_KEYS,
      UP_KEYS,
      DOWN_KEYS,
      LEFT_KEYS,
      RIGHT_KEYS,
      new int[] { Input.KEY_P });

  private Input input;
  private boolean controllerUpDown = false;
  private boolean controllerDownDown = false;
  private boolean controllerLeftDown = false;
  private boolean controllerRightDown = false;
  private boolean gamepadButtonStartDown = false;
  private boolean[] controllerCandidateKnown =
      new boolean[CONTROLLER_INDEX_LIMIT];
  private boolean[] controllerCandidate = new boolean[CONTROLLER_INDEX_LIMIT];
  private boolean controllersCreateAttempted = false;
  private boolean controllersUnavailable = false;
  private boolean sampledUp;
  private boolean sampledDown;
  private boolean sampledLeft;
  private boolean sampledRight;
  private boolean sampledStart;

  public HumanInput(GameContainer gc) {
    this(gc.getInput());
  }

  HumanInput(Input input) {
    installJInputPollFailureFilter();
    this.input = input;
    // JInput owns native resources for the lifetime of the process. Discover once.
    ensureControllersCreated();
    beginFrame();
  }

  public void beginFrame() {
    pollControllers();
    sampledUp = readControllerUp();
    sampledDown = readControllerDown();
    sampledLeft = readControllerLeft();
    sampledRight = readControllerRight();
    sampledStart = readControllerStart();
    if (isControllerInputUnavailable()) {
      sampledUp = sampledDown = sampledLeft = sampledRight = sampledStart = false;
      controllerUpDown = controllerDownDown = false;
      controllerLeftDown = controllerRightDown = gamepadButtonStartDown = false;
    }
  }

  public static void installJInputPollFailureFilter() {
    synchronized(POLL_LOG_FILTER_LOCK) {
      if (globalPollFailureFilterInstalled) {
        return;
      }

      System.setOut(new PrintStream(
          new JInputPollFilterStream(System.out), true));
      System.setErr(new PrintStream(
          new JInputPollFilterStream(System.err), true));
      globalPollFailureFilterInstalled = true;
    }
  }

  public void reset() {
    syncControllerState();
  }

  public boolean isUp() {
    return isAnyKeyDown(UP_KEYS)
        || isAnyControllerUp();
  }

  public boolean isDown() {
    return isAnyKeyDown(DOWN_KEYS)
        || isAnyControllerDown();
  }

  public boolean isLeft() {
    return isAnyKeyDown(LEFT_KEYS)
        || isAnyControllerLeft();
  }

  public boolean isRight() {
    return isAnyKeyDown(RIGHT_KEYS)
        || isAnyControllerRight();
  }

  public boolean isUpPressed() {
    boolean keyboard = isAnyKeyPressed(UP_KEYS);
    boolean controller = isControllerUpPressed();
    return keyboard || controller;
  }

  public boolean isDownPressed() {
    boolean keyboard = isAnyKeyPressed(DOWN_KEYS);
    boolean controller = isControllerDownPressed();
    return keyboard || controller;
  }

  public boolean isLeftPressed() {
    boolean keyboard = isAnyKeyPressed(LEFT_KEYS);
    boolean controller = isControllerLeftPressed();
    return keyboard || controller;
  }

  public boolean isRightPressed() {
    boolean keyboard = isAnyKeyPressed(RIGHT_KEYS);
    boolean controller = isControllerRightPressed();
    return keyboard || controller;
  }

  public boolean isMenuStartPressed() {
    boolean keyboard = isAnyKeyPressed(MENU_START_KEYS);
    boolean controller = isGamepadButtonStartPressed();
    return keyboard || controller;
  }

  public boolean isConfirmPressed() {
    boolean keyboard = isAnyKeyPressed(CONFIRM_START_KEYS);
    boolean controller = isGamepadButtonStartPressed();
    return keyboard || controller;
  }

  public boolean isGameplayStartPressed() {
    return isConfirmPressed();
  }

  public boolean isPausePressed() {
    return input.isKeyPressed(Input.KEY_P);
  }

  public boolean isFullscreenTogglePressed() {
    return input.isKeyPressed(Input.KEY_SPACE);
  }

  public boolean isFullscreenExitPressed() {
    return input.isKeyPressed(Input.KEY_ESCAPE);
  }

  public void clearKeyPressedRecord() {
    input.clearKeyPressedRecord();
    syncControllerState();
  }

  public boolean update() {
    return true;
  }

  private static int[] concat(int[]... arrays) {
    int length = 0;
    for(int i = 0; i < arrays.length; i++) {
      length += arrays[i].length;
    }

    int[] result = new int[length];
    int offset = 0;
    for(int i = 0; i < arrays.length; i++) {
      System.arraycopy(arrays[i], 0, result, offset, arrays[i].length);
      offset += arrays[i].length;
    }
    return result;
  }

  private boolean isAnyKeyDown(int[] keys) {
    for(int i = 0; i < keys.length; i++) {
      if (input.isKeyDown(keys[i])) {
        return true;
      }
    }
    return false;
  }

  private boolean isAnyKeyPressed(int[] keys) {
    boolean pressed = false;
    for(int i = 0; i < keys.length; i++) {
      pressed = input.isKeyPressed(keys[i]) || pressed;
    }
    return pressed;
  }

  private boolean isAnyControllerUp() {
    return sampledUp;
  }

  private boolean readControllerUp() {
    int controllerCount = getControllerCount();
    for(int controller = 0; controller < controllerCount; controller++) {
      Controller lwjglController = getGameController(controller);
      if (lwjglController != null
          && (isPovUp(lwjglController)
          || isDirectionalButtonDown(Main.UP, lwjglController)
          || isAnyStickUp(controller, lwjglController))) {
        return true;
      }
    }
    return false;
  }

  private boolean isAnyControllerDown() {
    return sampledDown;
  }

  private boolean readControllerDown() {
    int controllerCount = getControllerCount();
    for(int controller = 0; controller < controllerCount; controller++) {
      Controller lwjglController = getGameController(controller);
      if (lwjglController != null
          && (isPovDown(lwjglController)
          || isDirectionalButtonDown(Main.DOWN, lwjglController)
          || isAnyStickDown(controller, lwjglController))) {
        return true;
      }
    }
    return false;
  }

  private boolean isAnyControllerLeft() {
    return sampledLeft;
  }

  private boolean readControllerLeft() {
    int controllerCount = getControllerCount();
    for(int controller = 0; controller < controllerCount; controller++) {
      Controller lwjglController = getGameController(controller);
      if (lwjglController != null
          && (isPovLeft(lwjglController)
          || isDirectionalButtonDown(Main.LEFT, lwjglController)
          || isAnyStickLeft(controller, lwjglController))) {
        return true;
      }
    }
    return false;
  }

  private boolean isAnyControllerRight() {
    return sampledRight;
  }

  private boolean readControllerRight() {
    int controllerCount = getControllerCount();
    for(int controller = 0; controller < controllerCount; controller++) {
      Controller lwjglController = getGameController(controller);
      if (lwjglController != null
          && (isPovRight(lwjglController)
          || isDirectionalButtonDown(Main.RIGHT, lwjglController)
          || isAnyStickRight(controller, lwjglController))) {
        return true;
      }
    }
    return false;
  }

  private boolean isGamepadButtonStartPressed() {
    boolean down = isAnyNonDirectionalGamepadButtonDown();
    boolean pressed = down && !gamepadButtonStartDown;
    gamepadButtonStartDown = down;
    return pressed;
  }

  private boolean isControllerUpPressed() {
    boolean down = isAnyControllerUp();
    boolean pressed = down && !controllerUpDown;
    controllerUpDown = down;
    return pressed;
  }

  private boolean isControllerDownPressed() {
    boolean down = isAnyControllerDown();
    boolean pressed = down && !controllerDownDown;
    controllerDownDown = down;
    return pressed;
  }

  private boolean isControllerLeftPressed() {
    boolean down = isAnyControllerLeft();
    boolean pressed = down && !controllerLeftDown;
    controllerLeftDown = down;
    return pressed;
  }

  private boolean isControllerRightPressed() {
    boolean down = isAnyControllerRight();
    boolean pressed = down && !controllerRightDown;
    controllerRightDown = down;
    return pressed;
  }

  private boolean isAnyNonDirectionalGamepadButtonDown() {
    return sampledStart;
  }

  private boolean readControllerStart() {
    int controllerCount = getControllerCount();
    for(int controller = 0; controller < controllerCount; controller++) {
      Controller lwjglController = getGameController(controller);
      if (lwjglController == null) {
        continue;
      }
      int buttonCount = Math.min(lwjglController.getButtonCount(),
          GAMEPAD_BUTTON_INDEX_LIMIT);
      for(int button = 0; button < buttonCount; button++) {
        if (!isDirectionalButton(button, lwjglController)
            && isControllerButtonDown(button, lwjglController)) {
          return true;
        }
      }
    }
    return false;
  }

  private boolean isPovUp(Controller controller) {
    return readPovY(controller) < -AXIS_THRESHOLD;
  }

  private boolean isPovDown(Controller controller) {
    return readPovY(controller) > AXIS_THRESHOLD;
  }

  private boolean isPovLeft(Controller controller) {
    return readPovX(controller) < -AXIS_THRESHOLD;
  }

  private boolean isPovRight(Controller controller) {
    return readPovX(controller) > AXIS_THRESHOLD;
  }

  private boolean isAnyStickUp(int controllerIndex, Controller controller) {
    return isAnyStickAxisLessThan(controllerIndex, controller, 1,
        -AXIS_THRESHOLD);
  }

  private boolean isAnyStickDown(int controllerIndex, Controller controller) {
    return isAnyStickAxisGreaterThan(controllerIndex, controller, 1,
        AXIS_THRESHOLD);
  }

  private boolean isAnyStickLeft(int controllerIndex, Controller controller) {
    return isAnyStickAxisLessThan(controllerIndex, controller, 0,
        -AXIS_THRESHOLD);
  }

  private boolean isAnyStickRight(int controllerIndex, Controller controller) {
    return isAnyStickAxisGreaterThan(controllerIndex, controller, 0,
        AXIS_THRESHOLD);
  }

  private boolean isAnyStickAxisLessThan(
      int controllerIndex, Controller controller, int pairOffset,
      float threshold) {
    if (isAnyNamedStickAxisLessThan(controllerIndex, controller, pairOffset,
        threshold)) {
      return true;
    }

    int axisCount = Math.min(safeAxisCount(controller), GAMEPAD_AXIS_LIMIT);
    for(int axis = 0; axis < axisCount; axis++) {
      if (isDirectionalAxis(controller, axis, pairOffset)
          && readAxisValue(controllerIndex, controller, axis) <= threshold) {
        return true;
      }
    }
    return false;
  }

  private boolean isAnyStickAxisGreaterThan(
      int controllerIndex, Controller controller, int pairOffset,
      float threshold) {
    if (isAnyNamedStickAxisGreaterThan(controllerIndex, controller,
        pairOffset, threshold)) {
      return true;
    }

    int axisCount = Math.min(safeAxisCount(controller), GAMEPAD_AXIS_LIMIT);
    for(int axis = 0; axis < axisCount; axis++) {
      if (isDirectionalAxis(controller, axis, pairOffset)
          && readAxisValue(controllerIndex, controller, axis) >= threshold) {
        return true;
      }
    }
    return false;
  }

  private boolean isAnyNamedStickAxisLessThan(
      int controllerIndex, Controller controller, int pairOffset,
      float threshold) {
    return readNamedStickAxisValue(controllerIndex, controller,
        NAMED_X_AXIS_SLOT, NAMED_Y_AXIS_SLOT, pairOffset) <= threshold
        || readNamedStickAxisValue(controllerIndex, controller,
        NAMED_RX_AXIS_SLOT, NAMED_RY_AXIS_SLOT, pairOffset) <= threshold;
  }

  private boolean isAnyNamedStickAxisGreaterThan(
      int controllerIndex, Controller controller, int pairOffset,
      float threshold) {
    return readNamedStickAxisValue(controllerIndex, controller,
        NAMED_X_AXIS_SLOT, NAMED_Y_AXIS_SLOT, pairOffset) >= threshold
        || readNamedStickAxisValue(controllerIndex, controller,
        NAMED_RX_AXIS_SLOT, NAMED_RY_AXIS_SLOT, pairOffset) >= threshold;
  }

  private float readNamedStickAxisValue(
      int controllerIndex, Controller controller, int horizontalSlot,
      int verticalSlot, int pairOffset) {
    int axisSlot = pairOffset == 0 ? horizontalSlot : verticalSlot;
    return readNamedAxisValue(controllerIndex, controller, axisSlot);
  }

  private float readNamedAxisValue(
      int controllerIndex, Controller controller, int axisSlot) {
    try {
      int axis = getJInputNamedAxisIndex(controller, axisSlot);
      if (axis >= 0) {
        int pairOffset = getNamedAxisPairOffset(axisSlot);
        if (pairOffset >= 0
            && !isDirectionalAxis(controller, axis, pairOffset)) {
          return 0f;
        }
        return readAxisValue(controllerIndex, controller, axis);
      }

      float value = 0f;
      switch(axisSlot) {
        case NAMED_X_AXIS_SLOT:
          value = controller.getXAxisValue();
          break;
        case NAMED_Y_AXIS_SLOT:
          value = controller.getYAxisValue();
          break;
        case NAMED_RX_AXIS_SLOT:
          value = controller.getRXAxisValue();
          break;
        case NAMED_RY_AXIS_SLOT:
          value = controller.getRYAxisValue();
          break;
        default:
          return 0f;
      }
      return applyAxisDeadZone(value);
    } catch(RuntimeException e) {
      return 0f;
    }
  }

  private int getNamedAxisPairOffset(int axisSlot) {
    switch(axisSlot) {
      case NAMED_X_AXIS_SLOT:
      case NAMED_RX_AXIS_SLOT:
        return 0;
      case NAMED_Y_AXIS_SLOT:
      case NAMED_RY_AXIS_SLOT:
        return 1;
      default:
        return -1;
    }
  }

  private float readPovX(Controller controller) {
    try {
      float value = readJInputPovValue(controller);
      if (!Float.isNaN(value)) {
        return convertPovX(value);
      }
      return controller.getPovX();
    } catch(RuntimeException e) {
      return 0f;
    }
  }

  private float readPovY(Controller controller) {
    try {
      float value = readJInputPovValue(controller);
      if (!Float.isNaN(value)) {
        return convertPovY(value);
      }
      return controller.getPovY();
    } catch(RuntimeException e) {
      return 0f;
    }
  }

  private float readAxisValue(
      int controllerIndex, Controller controller, int axis) {
    try {
      if (axis < 0 || axis >= controller.getAxisCount()
          || axis >= GAMEPAD_AXIS_LIMIT) {
        return 0f;
      }

      float directValue = readJInputAxisValue(controller, axis);
      if (!Float.isNaN(directValue)) {
        return directValue;
      }
      return applyAxisDeadZone(controller.getAxisValue(axis));
    } catch(RuntimeException e) {
      return 0f;
    }
  }

  private int getJInputNamedAxisIndex(Controller controller, int axisSlot) {
    initJInputReflection(controller);
    Field field = null;
    switch(axisSlot) {
      case NAMED_X_AXIS_SLOT:
        field = jinputXAxisField;
        break;
      case NAMED_Y_AXIS_SLOT:
        field = jinputYAxisField;
        break;
      case NAMED_RX_AXIS_SLOT:
        field = jinputRXAxisField;
        break;
      case NAMED_RY_AXIS_SLOT:
        field = jinputRYAxisField;
        break;
      default:
        return -1;
    }
    if (field == null) {
      return -1;
    }

    try {
      return field.getInt(controller);
    } catch(IllegalAccessException e) {
      return -1;
    }
  }

  private float readJInputAxisValue(Controller controller, int axis) {
    initJInputReflection(controller);
    net.java.games.input.Component component =
        getJInputComponent(controller, jinputAxesField, axis);
    if (component == null) {
      return Float.NaN;
    }

    float value = readJInputComponentPollData(component);
    if (Float.isNaN(value)) {
      return Float.NaN;
    }

    float deadZone = Math.max(component.getDeadZone(),
        AXIS_RECENTER_THRESHOLD);
    if (Math.abs(value) <= deadZone) {
      return 0f;
    }
    return value;
  }

  private float readJInputPovValue(Controller controller) {
    initJInputReflection(controller);
    net.java.games.input.Component component =
        getJInputComponent(controller, jinputPovField, 0);
    if (component == null) {
      return Float.NaN;
    }
    return readJInputComponentPollData(component);
  }

  private float readJInputButtonValue(Controller controller, int button) {
    initJInputReflection(controller);
    net.java.games.input.Component component =
        getJInputComponent(controller, jinputButtonsField, button);
    if (component == null) {
      return Float.NaN;
    }
    return readJInputComponentPollData(component);
  }

  private float readJInputComponentPollData(
      net.java.games.input.Component component) {
    try {
      float value = component.getPollData();
      return isControllerInputUnavailable() ? Float.NaN : value;
    } catch(RuntimeException e) {
      return Float.NaN;
    }
  }

  private net.java.games.input.Component getJInputComponent(
      Controller controller, Field field, int index) {
    List<?> components = getJInputComponentList(controller, field);
    if (components == null || index < 0 || index >= components.size()) {
      return null;
    }

    Object component = components.get(index);
    if (component instanceof net.java.games.input.Component) {
      return (net.java.games.input.Component)component;
    }
    return null;
  }

  private List<?> getJInputComponentList(Controller controller, Field field) {
    if (field == null) {
      return null;
    }

    try {
      Object value = field.get(controller);
      if (!(value instanceof List)) {
        return null;
      }

      return (List<?>)value;
    } catch(IllegalAccessException e) {
      return null;
    }
  }

  private float convertPovX(float value) {
    if (isPovValue(value, 0.875f)
        || isPovValue(value, 0.125f)
        || isPovValue(value, 1f)) {
      return -1f;
    }
    if (isPovValue(value, 0.625f)
        || isPovValue(value, 0.375f)
        || isPovValue(value, 0.5f)) {
      return 1f;
    }
    return 0f;
  }

  private float convertPovY(float value) {
    if (isPovValue(value, 0.875f)
        || isPovValue(value, 0.625f)
        || isPovValue(value, 0.75f)) {
      return 1f;
    }
    if (isPovValue(value, 0.125f)
        || isPovValue(value, 0.375f)
        || isPovValue(value, 0.25f)) {
      return -1f;
    }
    return 0f;
  }

  private boolean isPovValue(float value, float target) {
    return Math.abs(value - target) < 0.001f;
  }

  private static void initJInputReflection(Controller controller) {
    if (jinputReflectionInitialized) {
      return;
    }

    synchronized(HumanInput.class) {
      if (jinputReflectionInitialized) {
        return;
      }
      try {
        Class<?> controllerClass = controller.getClass();
        jinputAxesField = getAccessibleField(controllerClass, "axes");
        jinputButtonsField = getAccessibleField(controllerClass, "buttons");
        jinputPovField = getAccessibleField(controllerClass, "pov");
        jinputXAxisField = getAccessibleField(controllerClass, "xaxis");
        jinputYAxisField = getAccessibleField(controllerClass, "yaxis");
        jinputRXAxisField = getAccessibleField(controllerClass, "rxaxis");
        jinputRYAxisField = getAccessibleField(controllerClass, "ryaxis");
      } catch(NoSuchFieldException e) {
        jinputAxesField = null;
        jinputButtonsField = null;
        jinputPovField = null;
        jinputXAxisField = null;
        jinputYAxisField = null;
        jinputRXAxisField = null;
        jinputRYAxisField = null;
      }
      jinputReflectionInitialized = true;
    }
  }

  private static Field getAccessibleField(Class<?> clazz, String name)
      throws NoSuchFieldException {
    Field field = clazz.getDeclaredField(name);
    field.setAccessible(true);
    return field;
  }

  private float applyAxisDeadZone(float value) {
    if (Math.abs(value) <= AXIS_RECENTER_THRESHOLD) {
      return 0f;
    }
    return value;
  }

  private boolean isDirectionalAxis(
      Controller controller, int axis, int pairOffset) {
    if (axis < 0 || axis >= safeAxisCount(controller)
        || axis >= GAMEPAD_AXIS_LIMIT) {
      return false;
    }

    String name = safeAxisName(controller, axis).toLowerCase();
    String identifier = getJInputAxisIdentifierName(controller, axis);
    if (isRejectedDirectionalAxisName(name)
        || isRejectedDirectionalAxisName(identifier)) {
      return false;
    }
    if (pairOffset == 0) {
      return isHorizontalAxisName(name)
          || isHorizontalAxisName(identifier);
    }
    return isVerticalAxisName(name)
        || isVerticalAxisName(identifier);
  }

  private String getJInputAxisIdentifierName(Controller controller, int axis) {
    initJInputReflection(controller);
    net.java.games.input.Component component =
        getJInputComponent(controller, jinputAxesField, axis);
    if (component == null || component.getIdentifier() == null) {
      return "";
    }
    return component.getIdentifier().toString().toLowerCase();
  }

  private boolean isRejectedDirectionalAxisName(String text) {
    return text.indexOf("accelerator") != -1
        || text.indexOf("accel") != -1
        || text.indexOf("brake") != -1
        || text.indexOf("trigger") != -1
        || text.indexOf("throttle") != -1
        || text.indexOf("slider") != -1
        || text.indexOf("volume") != -1;
  }

  private boolean isHorizontalAxisName(String text) {
    return containsDirectionWord(text, "x")
        || containsDirectionWord(text, "rx");
  }

  private boolean isVerticalAxisName(String text) {
    return containsDirectionWord(text, "y")
        || containsDirectionWord(text, "ry");
  }

  private boolean isControllerButtonDown(
      int button, Controller controller) {
    if (button < 0 || button >= controller.getButtonCount()
        || button >= GAMEPAD_BUTTON_INDEX_LIMIT) {
      return false;
    }
    try {
      float directValue = readJInputButtonValue(controller, button);
      if (!Float.isNaN(directValue)) {
        return directValue != 0f;
      }
      return controller.isButtonPressed(button);
    } catch(RuntimeException e) {
      return false;
    }
  }

  private boolean isDirectionalButtonDown(
      int direction, Controller controller) {
    int buttonCount = Math.min(controller.getButtonCount(),
        GAMEPAD_BUTTON_INDEX_LIMIT);
    for(int button = 0; button < buttonCount; button++) {
      if (isDirectionalButton(button, controller, direction)
          && isControllerButtonDown(button, controller)) {
        return true;
      }
    }
    return false;
  }

  private boolean isDirectionalButton(int button, Controller controller) {
    if (getButtonDirection(button, controller) != -1) {
      return true;
    }
    return button >= STANDARD_DPAD_UP && button <= STANDARD_DPAD_RIGHT;
  }

  private boolean isDirectionalButton(
      int button, Controller controller, int direction) {
    int namedDirection = getButtonDirection(button, controller);
    if (namedDirection != -1) {
      return namedDirection == direction;
    }

    switch(direction) {
      case Main.UP:
        if (button == STANDARD_DPAD_UP) {
          return true;
        }
        break;
      case Main.DOWN:
        if (button == STANDARD_DPAD_DOWN) {
          return true;
        }
        break;
      case Main.LEFT:
        if (button == STANDARD_DPAD_LEFT) {
          return true;
        }
        break;
      case Main.RIGHT:
        if (button == STANDARD_DPAD_RIGHT) {
          return true;
        }
        break;
      default:
        return false;
    }
    return getButtonDirection(button, controller) == direction;
  }

  private int getButtonDirection(int button, Controller controller) {
    try {
      String name = controller.getButtonName(button);
      if (name == null) {
        return -1;
      }
      return getDirectionFromButtonName(name);
    } catch(RuntimeException e) {
      return -1;
    }
  }

  private int getDirectionFromButtonName(String name) {
    String lower = name.toLowerCase();
    boolean directionalGroup = lower.indexOf("pov") != -1
        || lower.indexOf("hat") != -1
        || lower.indexOf("d-pad") != -1
        || lower.indexOf("dpad") != -1
        || lower.indexOf("direction") != -1
        || lower.indexOf("dir") != -1;

    if (containsDirectionWord(lower, "up")
        || containsDirectionWord(lower, "north")) {
      return Main.UP;
    }
    if (containsDirectionWord(lower, "down")
        || containsDirectionWord(lower, "south")) {
      return Main.DOWN;
    }
    if (containsDirectionWord(lower, "left")
        || containsDirectionWord(lower, "west")) {
      return Main.LEFT;
    }
    if (containsDirectionWord(lower, "right")
        || containsDirectionWord(lower, "east")) {
      return Main.RIGHT;
    }

    if (directionalGroup && (lower.indexOf("y-") != -1
        || lower.indexOf("-y") != -1)) {
      return Main.UP;
    }
    if (directionalGroup && (lower.indexOf("y+") != -1
        || lower.indexOf("+y") != -1)) {
      return Main.DOWN;
    }
    if (directionalGroup && (lower.indexOf("x-") != -1
        || lower.indexOf("-x") != -1)) {
      return Main.LEFT;
    }
    if (directionalGroup && (lower.indexOf("x+") != -1
        || lower.indexOf("+x") != -1)) {
      return Main.RIGHT;
    }
    return -1;
  }

  private boolean containsDirectionWord(String text, String word) {
    int index = text.indexOf(word);
    while(index != -1) {
      boolean before = index == 0 || !isAsciiLetterOrDigit(
          text.charAt(index - 1));
      int end = index + word.length();
      boolean after = end == text.length()
          || !isAsciiLetterOrDigit(text.charAt(end));
      if (before && after) {
        return true;
      }
      index = text.indexOf(word, index + 1);
    }
    return false;
  }

  private boolean isAsciiLetterOrDigit(char c) {
    return (c >= 'a' && c <= 'z')
        || (c >= '0' && c <= '9');
  }

  private Controller getGameController(int controllerIndex) {
    if (!isGameController(controllerIndex)) {
      return null;
    }
    return getLwjglController(controllerIndex);
  }

  private boolean isGameController(int controllerIndex) {
    if (controllerIndex < 0 || controllerIndex >= CONTROLLER_INDEX_LIMIT) {
      return false;
    }
    if (!controllerCandidateKnown[controllerIndex]) {
      controllerCandidateKnown[controllerIndex] = true;
      controllerCandidate[controllerIndex] =
          computeGameController(controllerIndex);
    }
    return controllerCandidate[controllerIndex];
  }

  private boolean computeGameController(int controllerIndex) {
    Controller controller = getLwjglController(controllerIndex);
    return isUsableGameController(controller);
  }

  private boolean isUsableGameController(Controller controller) {
    if (controller == null || isIgnoredController(controller)) {
      return false;
    }
    try {
      return controller.getAxisCount() >= 2 || controller.getButtonCount() > 0;
    } catch(RuntimeException e) {
      return false;
    }
  }

  private int safeButtonCount(Controller controller) {
    try {
      return controller.getButtonCount();
    } catch(RuntimeException e) {
      return 0;
    }
  }

  private int safeAxisCount(Controller controller) {
    try {
      return controller.getAxisCount();
    } catch(RuntimeException e) {
      return 0;
    }
  }

  private String safeButtonName(Controller controller, int button) {
    try {
      return safeString(controller.getButtonName(button));
    } catch(RuntimeException e) {
      return "<error " + e.getClass().getName() + ">";
    }
  }

  private String safeAxisName(Controller controller, int axis) {
    try {
      return safeString(controller.getAxisName(axis));
    } catch(RuntimeException e) {
      return "<error " + e.getClass().getName() + ">";
    }
  }

  private String safeString(String text) {
    return text == null ? "<null>" : text.replace('\n', ' ');
  }

  private Controller getLwjglController(int controllerIndex) {
    try {
      if (isControllerInputUnavailable()) {
        return null;
      }
      if (!Controllers.isCreated()
          || controllerIndex >= Controllers.getControllerCount()) {
        return null;
      }
      return Controllers.getController(controllerIndex);
    } catch(RuntimeException e) {
      return null;
    }
  }

  private boolean isNonGameControllerName(String name) {
    if (name == null) {
      return false;
    }
    String lower = name.toLowerCase();
    return lower.indexOf("keyboard") != -1
        || lower.indexOf("mouse") != -1
        || lower.indexOf("consumer control") != -1
        || lower.indexOf("system controller") != -1;
  }

  private boolean isIgnoredController(Controller controller) {
    return controller == null
        || isNonGameControllerName(controller.getName())
        || isVolumeOnlyController(controller);
  }

  private boolean isVolumeOnlyController(Controller controller) {
    int buttonCount = Math.min(safeButtonCount(controller),
        GAMEPAD_BUTTON_INDEX_LIMIT);
    if (buttonCount == 0) {
      return false;
    }

    for(int button = 0; button < buttonCount; button++) {
      if (!isVolumeControlButtonName(safeButtonName(controller, button))) {
        return false;
      }
    }
    return true;
  }

  private boolean isVolumeControlButtonName(String name) {
    String lower = name.toLowerCase();
    return lower.indexOf("volume") != -1
        || lower.indexOf("mute") != -1
        || lower.indexOf("media") != -1;
  }

  private int getControllerCount() {
    try {
      if (isControllerInputUnavailable()) {
        return 0;
      }
      if (!Controllers.isCreated()) {
        return 0;
      }
      return Math.min(Controllers.getControllerCount(),
          CONTROLLER_INDEX_LIMIT);
    } catch(RuntimeException e) {
      return 0;
    }
  }

  private boolean isControllerInputUnavailable() {
    return controllersUnavailable || globalPollFailureDetected;
  }

  private void ensureControllersCreated() {
    if (isControllerInputUnavailable()
        || Controllers.isCreated() || controllersCreateAttempted) {
      return;
    }

    controllersCreateAttempted = true;
    try {
      Controllers.create();
    } catch(Exception e) {
      controllersUnavailable = true;
    }
  }

  private void pollControllers() {
    if (isControllerInputUnavailable()) {
      return;
    }

    try {
      if (Controllers.isCreated()) {
        Controllers.poll();
        // This input layer reads state, not LWJGL's queued controller events.
        Controllers.clearEvents();
      }
    } catch(Exception e) {
      controllersUnavailable = true;
    }
  }

  private void syncControllerState() {
    controllerUpDown = isAnyControllerUp();
    controllerDownDown = isAnyControllerDown();
    controllerLeftDown = isAnyControllerLeft();
    controllerRightDown = isAnyControllerRight();
    gamepadButtonStartDown = isAnyNonDirectionalGamepadButtonDown();
  }

  private static class JInputPollFilterStream extends OutputStream {

    private final PrintStream target;
    private final ByteArrayOutputStream lineBuffer =
        new ByteArrayOutputStream();

    JInputPollFilterStream(PrintStream target) {
      this.target = target;
    }

    public synchronized void write(int value) throws IOException {
      lineBuffer.write(value);
      if (value == '\n') {
        flushBufferedLine();
      }
    }

    public synchronized void write(byte[] buffer, int offset, int length)
        throws IOException {
      for(int i = 0; i < length; i++) {
        write(buffer[offset + i]);
      }
    }

    public synchronized void flush() throws IOException {
      flushBufferedLine();
      target.flush();
    }

    private void flushBufferedLine() {
      if (lineBuffer.size() == 0) {
        return;
      }

      String line = lineBuffer.toString();
      lineBuffer.reset();
      if (!isSuppressedJInputPollLine(line)) {
        target.print(line);
      }
    }

    private boolean isSuppressedJInputPollLine(String line) {
      String text = line.trim();
      boolean pollFailure = text.startsWith("Failed to poll device:")
          || (text.startsWith("Failed to poll component:")
          && (text.indexOf("Failed to poll device") != -1
          || text.indexOf("Failed to get device state") != -1));
      boolean pluginLoadNotice = text.equals(
          "Loading: net.java.games.input.DirectAndRawInputEnvironmentPlugin");
      if (pollFailure) {
        globalPollFailureDetected = true;
      }
      return pollFailure || pluginLoadNotice;
    }

  }
}
