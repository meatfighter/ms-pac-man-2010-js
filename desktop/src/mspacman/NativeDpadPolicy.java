package mspacman;

import java.util.Locale;

final class NativeDpadPolicy {
  static final int NONE = -1, UP = 0, DOWN = 1, LEFT = 2, RIGHT = 3;
  private NativeDpadPolicy() {}

  static int direction(int button, String name) {
    if (button < 0 || button >= 64) return NONE;
    String n = name == null ? "" : name.trim().toLowerCase(Locale.ROOT);
    boolean group = word(n, "pov") || word(n, "hat") || word(n, "dpad")
        || n.contains("d-pad") || n.contains("d pad")
        || word(n, "direction") || word(n, "dir");
    boolean up = n.equals("up") || (group && (word(n, "up")
        || word(n, "north") || n.contains("y-") || n.contains("-y")));
    boolean down = n.equals("down") || (group && (word(n, "down")
        || word(n, "south") || n.contains("y+") || n.contains("+y")));
    boolean left = n.equals("left") || (group && (word(n, "left")
        || word(n, "west") || n.contains("x-") || n.contains("-x")));
    boolean right = n.equals("right") || (group && (word(n, "right")
        || word(n, "east") || n.contains("x+") || n.contains("+x")));
    int count = (up ? 1 : 0) + (down ? 1 : 0)
        + (left ? 1 : 0) + (right ? 1 : 0);
    if (count == 1) return up ? UP : down ? DOWN : left ? LEFT : RIGHT;
    if (count > 1) return NONE;
    if (button >= 12 && button <= 15 && isLegacyName(n)) return button - 12;
    return NONE;
  }

  private static boolean isLegacyName(String n) {
    if (n.isEmpty() || n.equals("hat") || n.equals("hat switch")
        || n.equals("pov") || n.equals("pov hat") || n.equals("dpad")
        || n.equals("d-pad") || n.equals("d pad")) return true;
    if (n.startsWith("button")) n = n.substring(6);
    boolean digit = false;
    for (int i = 0; i < n.length(); i++) {
      char c = n.charAt(i);
      if (c >= '0' && c <= '9') digit = true;
      else if (c != ' ' && c != '-' && c != '_' && c != '#'
          && c != '[' && c != ']') return false;
    }
    return digit;
  }

  private static boolean word(String text, String word) {
    for (int i = text.indexOf(word); i >= 0;
        i = text.indexOf(word, i + 1)) {
      int end = i + word.length();
      if ((i == 0 || !Character.isLetterOrDigit(text.charAt(i - 1)))
          && (end == text.length()
          || !Character.isLetterOrDigit(text.charAt(end)))) return true;
    }
    return false;
  }
}
