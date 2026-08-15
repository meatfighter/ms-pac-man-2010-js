package mspacman;

import org.newdawn.slick.*;

public class RobotInput implements IInput {
  
  private Input input;
  private byte[] data;
  private int index;

  public RobotInput(byte[] data, GameContainer gc) {
    input = gc.getInput();
    this.data = data;
    index = 0;
  }

  public void reset() {
    index = 0;
  }

  public boolean isUp() {
    return index < data.length ? (data[index] & 1) != 0 : false;
  }

  public boolean isDown() {
    return index < data.length ? (data[index] & 2) != 0 : false;
  }

  public boolean isLeft() {
    return index < data.length ? (data[index] & 4) != 0 : false;
  }

  public boolean isRight() {
    return index < data.length ? (data[index] & 8) != 0 : false;
  }

  public boolean isUpPressed() {
    return false;
  }

  public boolean isDownPressed() {
    return false;
  }

  public boolean isLeftPressed() {
    return false;
  }

  public boolean isRightPressed() {
    return false;
  }

  public boolean isMenuStartPressed() {
    return input.isKeyPressed(Input.KEY_ENTER)
        || input.isKeyPressed(Input.KEY_NUMPADENTER);
  }

  public boolean isConfirmPressed() {
    return input.isKeyPressed(Input.KEY_ENTER)
        || input.isKeyPressed(Input.KEY_NUMPADENTER);
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
    input.clearControlPressedRecord();
  }

  public boolean update() {
    return ++index < data.length;
  }
}
