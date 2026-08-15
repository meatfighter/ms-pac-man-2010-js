package mspacman;

public interface IInput {
  public void reset();
  public boolean isUp();
  public boolean isDown();
  public boolean isLeft();
  public boolean isRight();
  public boolean isUpPressed();
  public boolean isDownPressed();
  public boolean isLeftPressed();
  public boolean isRightPressed();
  public boolean isMenuStartPressed();
  public boolean isConfirmPressed();
  public boolean isGameplayStartPressed();
  public boolean isPausePressed();
  public boolean isFullscreenTogglePressed();
  public boolean isFullscreenExitPressed();
  public void clearKeyPressedRecord();
  public boolean update();
}
