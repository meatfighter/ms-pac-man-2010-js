package mspacman;

import java.lang.reflect.Field;
import java.util.List;
import net.java.games.input.Component;
import net.java.games.input.Controller;
import net.java.games.input.ControllerEnvironment;
import net.java.games.input.EventQueue;
import net.java.games.input.Rumbler;
import org.lwjgl.input.Controllers;
import org.newdawn.slick.Input;

/** Headless checks using the real LWJGL/JInput adapter and fake devices. */
public final class HumanInputTest {
  public static void main(String[] args) throws Exception {
    String scenario = args[0];
    Pad pad = new Pad();
    Environment environment = new Environment(
        scenario.equals("empty") ? new Controller[0] : new Controller[] {pad});
    environment.fail = scenario.equals("initialization-failure");
    Field defaultEnvironment = ControllerEnvironment.class
        .getDeclaredField("defaultEnvironment");
    defaultEnvironment.setAccessible(true);
    defaultEnvironment.set(null, environment);
    KeyboardInput keyboard = new KeyboardInput();
    HumanInput input = new HumanInput(keyboard);

    if (scenario.equals("empty") || environment.fail) {
      for (int i = 0; i < 2000; i++) {
        input.beginFrame();
        input.isUp();
        input.isConfirmPressed();
        input.reset();
      }
      check(environment.enumerations == 1, "Discovery must only run once");
      check(defaultEnvironment.get(null) == environment,
          "The native environment must not be replaced");
      keyboard.up = true;
      check(input.isUp(), "Keyboard must work without controller input");
    } else {
      pad.x.value = -1;
      pad.button.value = 1;
      input.beginFrame();
      int polls = pad.polls;
      check(input.isLeft(), "Stick direction");
      check(input.isConfirmPressed(), "Initial button press");
      check(!input.isConfirmPressed(), "Held button must not repeat its edge");
      for (int i = 0; i < 1000; i++) {
        input.isLeft();
        input.isRight();
        input.isUp();
        input.isDown();
        input.isConfirmPressed();
      }
      check(pad.polls == polls, "Getters must not poll devices");
      pad.x.value = 1;
      check(input.isLeft() && !input.isRight(),
          "Input remains stable until the next frame");
      input.beginFrame();
      check(pad.polls == polls + 1, "One device poll per frame");
      check(input.isRight() && !input.isLeft(), "Next frame refreshes direction");
      pad.button.value = 0;
      input.beginFrame();
      check(!input.isConfirmPressed(), "Button release");
      pad.button.value = 1;
      input.beginFrame();
      check(input.isConfirmPressed(), "Button can be pressed again");
      input.reset();
      check(!input.isConfirmPressed(), "Reset suppresses an already held press");
      if (scenario.equals("connected")) {
        pad.x.value = 0;
        pad.pov.value = Component.POV.UP;
        input.beginFrame();
        check(input.isUp() && !input.isDown(), "D-pad orientation");
        pad.pov.value = Component.POV.OFF;
        pad.y.value = -0.01f;
        input.beginFrame();
        check(!input.isUp(), "Stick dead zone");
        Field eventsField = Controllers.class.getDeclaredField("events");
        eventsField.setAccessible(true);
        List<?> events = (List<?>) eventsField.get(null);
        events.add(null);
        input.beginFrame();
        check(events.isEmpty(), "Unused events must not accumulate");
      } else {
        pad.fail = true;
        pad.reportFailure = scenario.equals("reported-failure");
        input.beginFrame();
        check(!input.isRight() && !input.isConfirmPressed(),
            "Failed polling must clear stale controller inputs");
        keyboard.up = true;
        check(input.isUp(), "Keyboard survives a disconnected controller");
        polls = pad.polls;
        for (int i = 0; i < 1000; i++) {
          input.beginFrame();
        }
        check(pad.polls == polls, "Failed polling must not become a retry loop");
      }
      check(environment.enumerations == 1, "No rediscovery after startup");
    }
    System.out.println("ok - desktop input " + scenario);
  }

  private static void check(boolean condition, String message) {
    if (!condition) {
      throw new AssertionError(message);
    }
  }

  private static final class KeyboardInput extends Input {
    boolean up;
    KeyboardInput() { super(600); }
    public boolean isKeyDown(int key) { return up && key == Input.KEY_UP; }
    public boolean isKeyPressed(int key) { return false; }
    public void clearKeyPressedRecord() {}
  }

  private static final class Environment extends ControllerEnvironment {
    final Controller[] controllers;
    int enumerations;
    boolean fail;
    Environment(Controller[] controllers) { this.controllers = controllers; }
    public Controller[] getControllers() {
      enumerations++;
      if (fail) {
        throw new IllegalStateException("Simulated discovery failure");
      }
      return controllers;
    }
    public boolean isSupported() { return true; }
  }

  private static final class Control implements Component {
    final Identifier identifier;
    float value;
    Control(Identifier identifier) { this.identifier = identifier; }
    public Identifier getIdentifier() { return identifier; }
    public boolean isRelative() { return false; }
    public boolean isAnalog() { return identifier instanceof Identifier.Axis; }
    public float getDeadZone() { return 0.05f; }
    public float getPollData() { return value; }
    public String getName() { return identifier.getName(); }
  }

  private static final class Pad implements Controller {
    final Control x = new Control(Component.Identifier.Axis.X);
    final Control y = new Control(Component.Identifier.Axis.Y);
    final Control pov = new Control(Component.Identifier.Axis.POV);
    final Control button = new Control(Component.Identifier.Button._0);
    final Component[] components = {x, y, pov, button};
    final EventQueue events = new EventQueue(32);
    int polls;
    boolean fail;
    boolean reportFailure;
    public Controller[] getControllers() { return new Controller[0]; }
    public Type getType() { return Type.GAMEPAD; }
    public Component[] getComponents() { return components; }
    public Component getComponent(Component.Identifier id) {
      for (Component component : components) {
        if (component.getIdentifier().equals(id)) {
          return component;
        }
      }
      return null;
    }
    public Rumbler[] getRumblers() { return new Rumbler[0]; }
    public boolean poll() {
      polls++;
      if (fail) {
        if (reportFailure) {
          System.err.println("Failed to poll device: test disconnected");
          return false;
        }
        throw new IllegalStateException("Simulated polling failure");
      }
      return true;
    }
    public void setEventQueueSize(int size) {}
    public EventQueue getEventQueue() { return events; }
    public PortType getPortType() { return PortType.USB; }
    public int getPortNumber() { return 0; }
    public String getName() { return "Test gamepad"; }
  }
}
