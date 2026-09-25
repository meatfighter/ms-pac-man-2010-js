package mspacman;

import java.util.Locale;

public final class NativeDpadPolicyTest {
  private static int checks;
  private static void expect(int expected, int button, String name) {
    int actual = NativeDpadPolicy.direction(button, name);
    if (actual != expected) throw new AssertionError(
        button + " / " + name + ": " + actual + " != " + expected);
    checks++;
  }
  public static void main(String[] args) {
    for (int button = 12; button <= 15; button++) {
      for (String name : new String[] { null, "", "  ", Integer.toString(button),
          "Button " + button, "Button_" + button, "Button [" + button + "]",
          "hat switch", "POV" }) expect(button - 12, button, name);
      for (String name : new String[] { "Left Trigger", "Right Trigger",
          "Left Thumb", "Right Thumb", "Left Bumper", "Right Bumper",
          "South", "North", "Extra Fire", "Mute", "Hat up left" }) {
        expect(-1, button, name);
      }
    }
    for (int button = 0; button < 64; button++) {
      expect(0, button, "D-pad Up");
      expect(1, button, "Hat Down");
      expect(2, button, "POV West");
      expect(3, button, "Direction x+");
      if (button < 12 || button > 15) expect(-1, button, Integer.toString(button));
    }
    expect(1, 12, "Hat Down");
    expect(-1, -1, "Hat Up");
    expect(-1, 64, "Hat Up");
    Locale old = Locale.getDefault();
    try {
      Locale.setDefault(new Locale("tr", "TR"));
      expect(3, 0, "DIRECTION RIGHT");
    } finally {
      Locale.setDefault(old);
    }
    System.out.println("ok - native D-pad policy " + checks);
  }
}
