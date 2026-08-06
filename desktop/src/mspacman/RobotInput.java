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

  public boolean isEnter() {
    return input.isKeyPressed(Input.KEY_ENTER);
  }

  public boolean isSpace() {
    return false;
  }

  public boolean isEscape() {
    return false;
  }

  public boolean isPause() {
    return false;
  }

  public void clearKeyPressedRecord() {
    input.clearKeyPressedRecord();
  }

  public boolean update() {
    return ++index < data.length;
  }
}
