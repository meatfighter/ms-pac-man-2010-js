package mspacman;

import org.newdawn.slick.*;

public class HumanInput implements IInput {

  private Input input;

  public HumanInput(GameContainer gc) {
    input = gc.getInput();
  }

  public void reset() {
  }

  public boolean isUp() {
    return input.isKeyDown(Input.KEY_UP) || input.isKeyDown(Input.KEY_W)
        || input.isKeyDown(Input.KEY_I) || input.isKeyDown(Input.KEY_8);
  }

  public boolean isDown() {
    return input.isKeyDown(Input.KEY_DOWN) || input.isKeyDown(Input.KEY_S)
        || input.isKeyDown(Input.KEY_K) || input.isKeyDown(Input.KEY_2);
  }

  public boolean isLeft() {
    return input.isKeyDown(Input.KEY_LEFT) || input.isKeyDown(Input.KEY_A)
        || input.isKeyDown(Input.KEY_J) || input.isKeyDown(Input.KEY_4);
  }

  public boolean isRight() {
    return input.isKeyDown(Input.KEY_RIGHT) || input.isKeyDown(Input.KEY_D)
        || input.isKeyDown(Input.KEY_L) || input.isKeyDown(Input.KEY_6);
  }

  public boolean isEnter() {
    return input.isKeyPressed(Input.KEY_ENTER);
  }

  public boolean isSpace() {
    return input.isKeyPressed(Input.KEY_SPACE);
  }

  public boolean isEscape() {
    return input.isKeyPressed(Input.KEY_ESCAPE);
  }

  public boolean isPause() {
    return input.isKeyPressed(Input.KEY_P);
  }

  public void clearKeyPressedRecord() {
    input.clearKeyPressedRecord();
  }

  public boolean update() {
    return true;
  }
}
