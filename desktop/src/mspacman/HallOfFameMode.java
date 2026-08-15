package mspacman;

import org.newdawn.slick.*;

public class HallOfFameMode implements IMode {

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  private Main main;
  private HighScore[][] highScores;
  private int pressEnterDelay;
  private boolean pressEnterVisible;
  private Image whiteEnergizer;
  private float dotsOffset;
  private int redOffset;
  private boolean enterPressed;
  private int fadeIndex;
  private int fadeState;
  private int ticks;
  private int countDown;
  private IInput input;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;
    input = main.input;
    highScores = main.highScores;
    whiteEnergizer = main.tiles[0][49];

    pressEnterDelay = 0;
    pressEnterVisible = false;
    dotsOffset = 0;
    redOffset = 0;
    enterPressed = false;
    fadeIndex = 22;
    fadeState = FADE_IN;
    ticks = 0;
    countDown = 0;
  }

  public void update(GameContainer gc) throws SlickException {

    if (countDown > 0) {
      if (--countDown == 0) {
        fadeState = FADE_OUT;
        fadeIndex = 0;
      }
    } else if (fadeState == FADE_OUT) {
      if (fadeIndex < 22) {
        fadeIndex++;
      } else {
        if (enterPressed) {
          main.setMode(Main.selectWorldMode, gc);
        } else {
          main.setMode(Main.attractMode, gc);
        }
      }
    } else if (ticks++ == 91 * 10) {
      fadeState = FADE_OUT;
      fadeIndex = 0;
    } else if (input.isMenuStartPressed()) {
      countDown = 60;
      enterPressed = true;
      main.demoMode = false;
      main.playSound(main.pressedEnterSound);
    } else if (fadeState == FADE_IN) {
      if (fadeIndex != 0) {
        fadeIndex--;
      } else {
        fadeState = FADE_NONE;
      }
    }

    if (pressEnterDelay == 0) {
      pressEnterDelay = 35;
      pressEnterVisible = !pressEnterVisible;
    } else {
      pressEnterDelay--;
    }

    dotsOffset -= 3f;
    while(dotsOffset < -32) {
      dotsOffset += 32;
      redOffset++;
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    main.drawString("HALL OF FAME", 16, Main.YELLOW);
    main.drawString("WORLD", 16 * 6, 16 * 4, Main.YELLOW);
    main.drawString("RANK", 16 * 16, 16 * 4, Main.YELLOW);
    main.drawString("SCORE", 16 * 29, 16 * 4, Main.YELLOW);
    main.drawString("INITIALS", 16 * 36, 16 * 4, Main.YELLOW);

    main.drawString("BLINKYS", 16 * 6, 18 * 6, Main.RED);
    main.drawString("1", 16 * 19, 18 * 6, Main.WHITE);
    main.drawString("2", 16 * 19, 18 * 7, Main.WHITE);
    main.drawString("3", 16 * 19, 18 * 8, Main.WHITE);
    main.drawString("4", 16 * 19, 18 * 9, Main.WHITE);
    main.drawString("5", 16 * 19, 18 * 10, Main.WHITE);

    main.drawString("PINKYS", 16 * 6, 18 * 12, Main.PINK);
    main.drawString("1", 16 * 19, 18 * 12, Main.WHITE);
    main.drawString("2", 16 * 19, 18 * 13, Main.WHITE);
    main.drawString("3", 16 * 19, 18 * 14, Main.WHITE);
    main.drawString("4", 16 * 19, 18 * 15, Main.WHITE);
    main.drawString("5", 16 * 19, 18 * 16, Main.WHITE);

    main.drawString("INKYS", 16 * 6, 18 * 18, Main.CYAN);
    main.drawString("1", 16 * 19, 18 * 18, Main.WHITE);
    main.drawString("2", 16 * 19, 18 * 19, Main.WHITE);
    main.drawString("3", 16 * 19, 18 * 20, Main.WHITE);
    main.drawString("4", 16 * 19, 18 * 21, Main.WHITE);
    main.drawString("5", 16 * 19, 18 * 22, Main.WHITE);

    main.drawString("SUES", 16 * 6, 18 * 24, Main.ORANGE);
    main.drawString("1", 16 * 19, 18 * 24, Main.WHITE);
    main.drawString("2", 16 * 19, 18 * 25, Main.WHITE);
    main.drawString("3", 16 * 19, 18 * 26, Main.WHITE);
    main.drawString("4", 16 * 19, 18 * 27, Main.WHITE);
    main.drawString("5", 16 * 19, 18 * 28, Main.WHITE);

    for(int i = 0, offset = 6; i < 4; i++, offset += 6) {
      for(int j = 0; j < 5; j++) {
        int y = 18 * (offset + j);
        HighScore highScore = highScores[i][j];
        main.drawNumber(highScore.score, 10, 16 * 24, y, Main.WHITE);
        main.drawString(highScore.initials, 16 * 36, y, Main.WHITE);
      }
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

    if (pressEnterVisible) {
      main.drawString("PRESS START", 560, Main.WHITE);
    }

    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
    }
  }
}
