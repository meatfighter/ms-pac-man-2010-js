package mspacman;

import org.newdawn.slick.*;

public class EnterInitialsMode implements IMode {

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  private Main main;
  private int fadeIndex;
  private int fadeState;
  private Image whiteEnergizer;
  private float dotsOffset;
  private int redOffset;
  private int editingIndex;
  private String initials;
  private String blinkingInitials;
  private boolean editVisible;
  private int blinkTimer;
  private IInput input;
  private boolean enterPressed;
  private String newScoreOf;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;
    input = main.input;
    fadeIndex = 22;
    fadeState = FADE_IN;
    whiteEnergizer = main.tiles[0][49];
    dotsOffset = 0;
    redOffset = 0;
    editingIndex = 0;
    initials = "AAA";
    blinkingInitials = " AA";
    editVisible = true;
    blinkTimer = 0;
    newScoreOf = "YOU ACHIEVED A SCORE OF " + main.score + ".";
    enterPressed = false;
    main.uploadComplete = false;

    input.clearKeyPressedRecord();
  }

  public void update(GameContainer gc) throws SlickException {
    if (fadeState == FADE_IN) {
      if (fadeIndex > 0) {
        fadeIndex--;
      } else {
        fadeState = FADE_NONE;
        main.playSound(main.clappingSound);
      }
    } else if (fadeState == FADE_OUT) {
      if (fadeIndex < 22) {
        fadeIndex++;
      } else {
        main.setMode(Main.hallOfFameMode, gc);
        return;
      }
    }

    if (++blinkTimer == 45) {
      blinkTimer = 0;
      editVisible = !editVisible;
    }

    dotsOffset -= 3f;
    while(dotsOffset < -32) {
      dotsOffset += 32;
      redOffset++;
    }

    boolean start = input.isConfirmPressed();
    if (enterPressed) {
      if (fadeState == FADE_NONE && main.uploadComplete) {
        fadeState = FADE_OUT;
        fadeIndex = 0;
      }
    } else if (input.isLeftPressed()) {
      if (editingIndex > 0) {
        editingIndex--;
        updateStrings();
        main.playSound(main.ateEnergizerSound);
      }
    } else if (input.isRightPressed() || (editingIndex != 2 && start)) {
      if (editingIndex < 2) {
        editingIndex++;
        updateStrings();
        main.playSound(main.ateEnergizerSound);
      }
    } else if (input.isDownPressed()) {
      char c = initials.charAt(editingIndex);
      if (c == 'Z') {
        c = ' ';
      } else if (c == ' ') {
        c = 'A';
      } else {
        c++;
      }
      setChar(c);
    } else if (input.isUpPressed()) {
      char c = initials.charAt(editingIndex);
      if (c == 'A') {
        c = ' ';
      } else if (c == ' ') {
        c = 'Z';
      } else {
        c--;
      }
      setChar(c);
    } else if (start) {
      enterPressed = true;
      main.playSound(main.pressedEnterSound);
      main.accessScoresDatabaseAsync(true, main.worldIndex, main.score,
          initials);
    }
  }

  private void setChar(char c) {
    StringBuilder sb = new StringBuilder();
    for(int i = 0; i < 3; i++) {
      if (i == editingIndex) {
        sb.append(c);
      } else {
        sb.append(initials.charAt(i));
      }
    }
    initials = sb.toString();
    updateStrings();
    main.playSound(main.atePellotSound);
  }

  private void updateStrings() {
    StringBuilder sb = new StringBuilder();
    for(int i = 0; i < 3; i++) {
      if (i == editingIndex) {
        if (initials.charAt(i) == ' ') {
          sb.append("-");
        } else {
          sb.append(" ");
        }
      } else {
        sb.append(initials.charAt(i));
      }
    }
    blinkingInitials = sb.toString();
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    if (enterPressed) {
      main.drawString("UPLOADING HIGH SCORE...", 292, Main.YELLOW);
    } else {
      main.drawString("WELCOME TO THE HALL OF FAME", 48, Main.YELLOW);
      main.drawString(newScoreOf, 96, Main.WHITE);
      main.drawString("USE ARROWS TO ENTER YOUR INITIALS.", 144, Main.WHITE);
      main.drawString("PRESS START TO SUBMIT.", 176, Main.WHITE);

      main.drawString(editVisible ? initials : blinkingInitials,
          304, 268, Main.ORANGE, 4);
    }

    float y = dotsOffset;
    for(int i = 0; i < 20; i++, y += 32) {
      if (((i + redOffset) % 10) == 0) {
        main.redEnergizerSprite.draw(16, y);
        main.redEnergizerSprite.draw(800 - 16 - 16, y);
      } else {
        whiteEnergizer.draw(16, y);
        whiteEnergizer.draw(800 - 16 - 16, y);
      }
    }

    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
    }
  }
}
