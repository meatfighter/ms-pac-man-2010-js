package mspacman;

import org.newdawn.slick.*;

public class AttractMode implements IMode {

  public static final float Z0 = -800f;

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  public static final int STATE_FLYING_TITLE = 0;
  public static final int STATE_2010 = 1;
  public static final int STATE_BARS = 2;
  public static final int STATE_STARING = 3;

  public static final String ATTRIBUTION_TEXT
      = "2010, 2026 MEATFIGHTER.COM";

  private Main main;
  private Image whiteEnergizer;
  private float dotsOffset;
  private int redOffset;
  private int fadeIndex;
  private int fadeState;
  private int state;
  private float titleZ;
  private float titleY;
  private float titleVy;
  private float y2010;
  private float barsY;
  private int pressEnterDelay;
  private boolean pressEnterVisible;
  private int ghostSpriteIndex;
  private int ghostSpriteIndexIncrementor;
  private int ghostsVisible;
  private float ghostX;
  private IInput input;
  private boolean enterPressed;
  private int ticks;
  private int countDown;

  public void init(Main main, GameContainer gc) throws SlickException {

    this.main = main;
    input = main.input;

    whiteEnergizer = main.tiles[0][49];
    fadeIndex = 0;
    fadeState = FADE_NONE;
    state = STATE_FLYING_TITLE;
    titleZ = 0;
    titleY = 0;
    titleVy = 0;
    y2010 = 0;
    barsY = 0;
    pressEnterVisible = false;
    pressEnterDelay = 0;
    ghostSpriteIndex = 0;
    ghostSpriteIndexIncrementor = 0;
    ghostsVisible = 0;
    enterPressed = false;
    ticks = 0;
    countDown = 0;
    dotsOffset = 0f;
    redOffset = 0;

    main.lives = 5;
    main.score = 0;
    main.worldIndex = 0;
    main.stageIndex = 0;
    main.demoMode = false;

    initFlyingTitle();

    input.clearKeyPressedRecord();

    main.playMusic(main.highScoreMusic);
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
          main.demoMode = true;
          main.setMode(Main.playingMode, gc);
        }
        return;
      }
    } else if (ticks++ == 3386) {
      fadeState = FADE_OUT;
      fadeIndex = 0;
    } else if (input.isMenuStartPressed()) {
      main.demoMode = false;
      countDown = 60;
      enterPressed = true;
      main.stopMusic();
      main.playSound(main.pressedEnterSound);
    }

    if (!enterPressed) {
      switch(state) {
        case STATE_FLYING_TITLE:
          updateFlyingTitle();
          break;
        case STATE_2010:
          update2010();
          break;
        case STATE_BARS:
          updateBars();
          break;
        case STATE_STARING:
          updateStaring();
          break;
      }
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    switch(state) {
      case STATE_FLYING_TITLE:
        renderFlyingTitle(gc, g);
        break;
      case STATE_2010:
        render2010(gc, g);
        break;
      case STATE_BARS:
        renderBars(gc, g);
        break;
      case STATE_STARING:
        renderStaring(gc, g);
        break;
    }

    renderFade(gc, g);
  }

  private void initStaring() {
    state = STATE_STARING;
    pressEnterVisible = false;
    pressEnterDelay = 0;
    ghostX = 800f;
    ghostsVisible = 0;
  }

  private void updateStaring() {
    updateDots();
    updateSpriteIndices();

    if (pressEnterDelay == 0) {
      pressEnterDelay = 35;
      pressEnterVisible = !pressEnterVisible;
    } else {
      pressEnterDelay--;
    }

    if (ghostsVisible < 4) {
      if (ghostX > 328) {
        ghostX -= 2f;
      } else {
        ghostsVisible++;
        ghostX = 800f;
      }
    }
  }

  private void renderStaring(
      GameContainer gc, Graphics g) throws SlickException {
    renderBars(gc, g);

    if (pressEnterVisible) {
      main.drawString("PRESS START", 456, Main.WHITE);
    }
    main.drawString("STARRING", 246, Main.WHITE);
    main.drawString(ATTRIBUTION_TEXT, 536, Main.WHITE);
    main.drawString("SPACE BAR - TOGGLE FULL-SCREEN MODE", 488, Main.WHITE);
    
    for(int i = 0; i < ghostsVisible; i++) {
      int y = 300 + (i << 5);
      main.ghostSprites[i][Main.RIGHT][ghostSpriteIndex].draw(328, y - 8);
      switch(i) {
        case 0:
          main.drawString("BLINKY", 376, y, Main.RED);
          break;
        case 1:
          main.drawString(" PINKY", 376, y, Main.PINK);
          break;
        case 2:
          main.drawString("  INKY", 376, y, Main.CYAN);
          break;
        case 3:
          main.drawString("   SUE", 376, y, Main.ORANGE);
          break;
      }
    }

    if (ghostsVisible < 4) {
      int y = 300 + (ghostsVisible << 5);
      main.ghostSprites[ghostsVisible][Main.LEFT][ghostSpriteIndex]
          .draw(ghostX, y - 8);
    }
  }

  private void initBars() {
    state = STATE_BARS;
    barsY = -16f;
  }

  private void updateBars() {
    updateDots();

    if (barsY < 32) {
      barsY += 1f;
    } else {
      barsY = 32;
      initStaring();
    }
  }

  private void updateDots() {
    dotsOffset -= 3f;
    while(dotsOffset < -32) {
      dotsOffset += 32;
      redOffset++;
    }
  }

  private void renderBars(GameContainer gc, Graphics g) throws SlickException {
    main.drawString("MS.PAC-MAN", 160, 106, Main.ORANGE, 3);
    main.drawString("2010", 336, 160, Main.ORANGE, 2);

    float x = dotsOffset;
    float y = 600 - barsY;
    for(int i = 0; i < 26; i++, x += 32) {
      if (((i + redOffset) % 10) == 0) {
        main.redEnergizerSprite.draw(x, barsY);
        main.redEnergizerSprite.draw(x, y);
      } else {
        whiteEnergizer.draw(x, barsY);
        whiteEnergizer.draw(x, y);
      }
    }
  }

  private void init2010() {
    state = STATE_2010;
    y2010 = 600f;
  }

  private void update2010() {
    if (y2010 > 160) {
      y2010 -= 5f;
    } else {
      y2010 = 160;
      initBars();
    }
  }

  private void render2010(GameContainer gc, Graphics g) throws SlickException {
    main.drawString("MS.PAC-MAN", 160, 106, Main.ORANGE, 3);
    main.drawString("2010", 336, y2010, Main.ORANGE, 2);
  }

  private void initFlyingTitle() {
    state = STATE_FLYING_TITLE;
    titleY = 91.450073f;
    titleVy = -9.45f;
    titleZ = -664;
  }

  private void updateFlyingTitle() {
    if (titleZ < 0) {
      titleZ += 8f;
      titleY += titleVy;
      titleVy += 0.15f;
    } else {
      init2010();
    }
  }

  private void renderFlyingTitle(
      GameContainer gc, Graphics g) throws SlickException {
    drawString("MS.PAC-MAN", 0, titleY, titleZ, Main.ORANGE, 3);
  }

  private void drawString(
      String s, float x, float y, float z, int color, float scale) {
    if (z <= Z0) {
      return;
    }
    float k = Z0 / (Z0 - z);
    x -= scale * (s.length() << 3);
    y -= 8 * scale;
    main.drawString(s, 400f + k * x, 300f + k * y, color, k * scale);
  }

  private void updateSpriteIndices() {
    if (++ghostSpriteIndexIncrementor == Ghost.FLUTTER_SPEED) {
      ghostSpriteIndexIncrementor = 0;
      if (++ghostSpriteIndex == 2) {
        ghostSpriteIndex = 0;
      }
    }
  }

  private void renderFade(GameContainer gc, Graphics g) {
    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
    }
  }
}
