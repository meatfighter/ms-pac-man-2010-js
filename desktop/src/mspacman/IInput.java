package mspacman;

public interface IInput {
  public void reset();
  public boolean isUp();
  public boolean isDown();
  public boolean isLeft();
  public boolean isRight();
  public boolean isEnter();
  public boolean isSpace();
  public boolean isEscape();
  public boolean isPause();
  public void clearKeyPressedRecord();
  public boolean update();
}
