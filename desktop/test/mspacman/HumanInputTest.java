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
    if (scenario.equals("named-ordinary-buttons")) {
      String[] names = {"Left Trigger", "Right Thumb", "Extra Fire", "Right Bumper"};
      for (int i=0;i<4;i++) pad.buttons[12+i].name=names[i];
    }
    if (scenario.equals("named-direction-buttons")) {
      pad.buttons[12].name="Hat Down"; pad.buttons[3].name="POV West";
    }
    Environment environment = new Environment(
        scenario.equals("empty") ? new Controller[0] : new Controller[] {pad});
    environment.fail = scenario.equals("initialization-failure") || scenario.equals("initialization-linkage-failure");
    environment.linkage = scenario.equals("initialization-linkage-failure");
    Field defaultEnvironment = ControllerEnvironment.class
        .getDeclaredField("defaultEnvironment");
    defaultEnvironment.setAccessible(true);
    defaultEnvironment.set(null, environment);
    KeyboardInput keyboard = new KeyboardInput();
    HumanInput input = new HumanInput(keyboard);
    if (scenario.endsWith("-buttons") || scenario.equals("pov-only")) {
      verifyLayout(pad, scenario);
      check(environment.enumerations == 1, "Layout discovery stays startup-only");
      System.out.println("ok - native layout " + scenario); return;
    }

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
        pad.x.value=0;pad.y.value=0;pad.button.value=0;input.beginFrame();
        EnterInitialsEdgeTest.QuietMain main=new EnterInitialsEdgeTest.QuietMain();main.input=input;
        EnterInitialsMode mode=new EnterInitialsMode();mode.init(main,null);EnterInitialsEdgeTest.set(mode,"editingIndex",1);
        pad.x.value=-1;pad.y.value=1;input.beginFrame();mode.update(null);mode.update(null);
        check(EnterInitialsEdgeTest.get(mode,"editingIndex").equals(0)&&EnterInitialsEdgeTest.get(mode,"initials").equals("AAA"),"Actual native adapter diagonal does not replay losing Down");
        pad.x.value=0;pad.y.value=0;input.beginFrame();mode.update(null);
        pad.y.value=1;input.beginFrame();mode.update(null);check(EnterInitialsEdgeTest.get(mode,"initials").equals("BAA"),"Native release/repress");
        verifySafeScanners(input);

      } else {
        pad.fail = true;
        pad.linkage = scenario.equals("poll-linkage-failure");
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

  private static void verifyLayout(Pad pad, String scenario) throws Exception {
    HumanInput input = new HumanInput(new KeyboardInput());
    input.beginFrame();
    for (int i=0;i<4;i++) {
      pad.buttons[12+i].value=1; input.beginFrame();
      boolean[] directions = { input.isUp(), input.isDown(), input.isLeft(), input.isRight() };
      for(int d=0;d<4;d++) check(directions[d] == (!scenario.equals("named-ordinary-buttons") && d==(scenario.equals("named-direction-buttons") && i==0 ? 1 : i)), "Layout direction " + scenario + "/" + i + "/" + d);
      check(input.isConfirmPressed() == scenario.equals("named-ordinary-buttons"), "Generic confirm classification");
      pad.buttons[12+i].value=0; input.beginFrame(); input.isConfirmPressed();
    }
    if (scenario.equals("named-direction-buttons")) { pad.buttons[3].value=1; input.beginFrame(); check(input.isLeft() && !input.isConfirmPressed(), "Named direction outside legacy range"); pad.buttons[3].value=0; }
    if (scenario.equals("legacy-buttons")) { pad.buttons[12].value=1;pad.buttons[14].value=1;input.beginFrame();check(input.isUp() && input.isLeft(),"Legacy diagonal");pad.buttons[12].value=0;pad.buttons[14].value=0; }
    float[] povs={Component.POV.UP,Component.POV.DOWN,Component.POV.LEFT,Component.POV.RIGHT,Component.POV.UP_LEFT,Component.POV.DOWN_RIGHT};
    boolean[][] expected={{true,false,false,false},{false,true,false,false},{false,false,true,false},{false,false,false,true},{true,false,true,false},{false,true,false,true}};
    for(int i=0;i<povs.length;i++){pad.pov.value=povs[i];input.beginFrame();boolean[] dirs={input.isUp(),input.isDown(),input.isLeft(),input.isRight()};for(int d=0;d<4;d++)check(dirs[d]==expected[i][d],"Actual POV cardinal/diagonal");check(!input.isConfirmPressed(),"POV cannot confirm");pad.pov.value=Component.POV.OFF;input.beginFrame();check(!input.isUp()&&!input.isDown()&&!input.isLeft()&&!input.isRight(),"POV release");}
  }

  private static void verifySafeScanners(HumanInput input)throws Exception {
    for(final int count:new int[]{-1,0,65,Integer.MIN_VALUE}){
      final int[] reads={0};
      org.lwjgl.input.Controller controller=(org.lwjgl.input.Controller)java.lang.reflect.Proxy.newProxyInstance(org.lwjgl.input.Controller.class.getClassLoader(),new Class<?>[]{org.lwjgl.input.Controller.class},(proxy,method,args)->{
        if(method.getName().equals("getButtonCount")){if(count==Integer.MIN_VALUE)throw new IllegalStateException("count unavailable");return count;}
        if(method.getName().equals("getButtonName")){check((Integer)args[0]>=0&&(Integer)args[0]<64,"Bounded name read");return "Extra Fire";}
        if(method.getName().equals("isButtonPressed")){int i=(Integer)args[0];check(i>=0&&i<64&&i<count,"Bounded button read");reads[0]++;return false;}
        return method.getReturnType()==int.class?0:method.getReturnType()==float.class?0f:method.getReturnType()==boolean.class?false:null;
      });
      java.lang.reflect.Method button=HumanInput.class.getDeclaredMethod("isControllerButtonDown",int.class,org.lwjgl.input.Controller.class);button.setAccessible(true);
      java.lang.reflect.Method direction=HumanInput.class.getDeclaredMethod("isDirectionalButtonDown",int.class,org.lwjgl.input.Controller.class);direction.setAccessible(true);
      for(int i=-1;i<=65;i++)check(!(Boolean)button.invoke(input,i,controller),"Safe direct scanner");
      for(int d=0;d<4;d++)check(!(Boolean)direction.invoke(input,d,controller),"Safe directional scanner");
      check(reads[0]<=64,"Scan bounded by 64");
    }
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
    boolean linkage;
    Environment(Controller[] controllers) { this.controllers = controllers; }
    public Controller[] getControllers() {
      enumerations++;
      if (fail) {
        if(linkage) throw new UnsatisfiedLinkError("Simulated discovery linkage failure");
        throw new IllegalStateException("Simulated discovery failure");
      }
      return controllers;
    }
    public boolean isSupported() { return true; }
  }

  private static final class Control implements Component {
    final Identifier identifier;
    float value;
    String name;
    Control(Identifier identifier) { this.identifier = identifier; }
    public Identifier getIdentifier() { return identifier; }
    public boolean isRelative() { return false; }
    public boolean isAnalog() { return identifier instanceof Identifier.Axis; }
    public float getDeadZone() { return 0.05f; }
    public float getPollData() { return value; }
    public String getName() { return name == null ? identifier.getName() : name; }
  }

  private static final class Pad implements Controller {
    final Control x = new Control(Component.Identifier.Axis.X);
    final Control y = new Control(Component.Identifier.Axis.Y);
    final Control pov = new Control(Component.Identifier.Axis.POV);
    final Control[] buttons = { new Control(Component.Identifier.Button._0), new Control(Component.Identifier.Button._1), new Control(Component.Identifier.Button._2), new Control(Component.Identifier.Button._3), new Control(Component.Identifier.Button._4), new Control(Component.Identifier.Button._5), new Control(Component.Identifier.Button._6), new Control(Component.Identifier.Button._7), new Control(Component.Identifier.Button._8), new Control(Component.Identifier.Button._9), new Control(Component.Identifier.Button._10), new Control(Component.Identifier.Button._11), new Control(Component.Identifier.Button._12), new Control(Component.Identifier.Button._13), new Control(Component.Identifier.Button._14), new Control(Component.Identifier.Button._15) };
    final Control button = buttons[0];
    final Component[] components = {x, y, pov, buttons[0], buttons[1], buttons[2], buttons[3], buttons[4], buttons[5], buttons[6], buttons[7], buttons[8], buttons[9], buttons[10], buttons[11], buttons[12], buttons[13], buttons[14], buttons[15] };
    final EventQueue events = new EventQueue(32);
    int polls;
    boolean fail;
    boolean linkage;
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
        if(linkage) throw new NoClassDefFoundError("Simulated polling linkage failure");
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
