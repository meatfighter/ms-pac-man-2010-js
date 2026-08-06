package mspacman;

import org.newdawn.slick.*;

public class Act2Mode implements IMode {

  public static final int PAUSE_BEFORE_CLACK = 45;
  public static final int PAUSE_AFTER_CLACK = 45;

  public static final int STATE_CLAPPER = 0;
  public static final int STATE_TOP_RIGHT = 1;
  public static final int STATE_BOTTOM_LEFT = 2;
  public static final int STATE_MIDDLE_RIGHT = 3;
  public static final int STATE_TOP_LEFT = 4;
  public static final int STATE_BOTTOM_RIGHT = 5;

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  private Main main;
  private int state;
  private int substate;
  private int topClapperIndex;
  private int timer;
  private int fadeIndex;
  private int fadeState;
  private float mspacmanX;
  private float pacmanX;
  private int chompSpriteIndex;
  private int chompSpriteIndexIncrementor;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;

    state = STATE_CLAPPER;
    timer = 0;
    substate = 0;
    topClapperIndex = 0;
    fadeIndex = 22;
    fadeState = FADE_IN;
  }

  public void update(GameContainer gc) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        updateClapper();
        break;
      case STATE_TOP_RIGHT:
        updateTopRight();
        break;
      case STATE_BOTTOM_LEFT:
        updateBottomLeft();
        break;
      case STATE_MIDDLE_RIGHT:
        updateMiddleRight();
        break;
      case STATE_TOP_LEFT:
        updateTopLeft();
        break;
      case STATE_BOTTOM_RIGHT:
        updateBottomRight(gc);
        break;
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        renderClapper(gc, g);
        break;
      case STATE_TOP_RIGHT:
        renderTopRight();
        break;
      case STATE_BOTTOM_LEFT:
        renderBottomLeft();
        break;
      case STATE_MIDDLE_RIGHT:
        renderMiddleRight();
        break;
      case STATE_TOP_LEFT:
        renderTopLeft();
        break;
      case STATE_BOTTOM_RIGHT:
        renderBottomRight();
        break;
    }
  }

  private void initTopRight() {
    state = STATE_TOP_RIGHT;    
    mspacmanX = -32f - 10 * 91;
    pacmanX = mspacmanX - 32f * 5;
  }

  private void updateTopRight() {
    updateSpriteIndices();
    pacmanX += 3f;
    mspacmanX += 3f;
    if (pacmanX > 800 + 4 * 91) {
      initBottomLeft();
    }
  }

  private void renderTopRight() {
    main.pacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(pacmanX, 184);
    main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(mspacmanX, 184);
  }

  private void initBottomLeft() {
    state = STATE_BOTTOM_LEFT;
    pacmanX = 800f;
    mspacmanX = pacmanX + 32f * 5;
  }

  private void updateBottomLeft() {
    updateSpriteIndices();
    pacmanX -= 3f;
    mspacmanX -= 3f;
    if (mspacmanX < -32f - 3 * 91) {
      initMiddleRight();
    }
  }

  private void renderBottomLeft() {
    main.pacmanSprites[Main.LEFT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(pacmanX, 384);
    main.mspacmanSprites[Main.LEFT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(mspacmanX, 384);
  }

  private void initMiddleRight() {
    state = STATE_MIDDLE_RIGHT;
    mspacmanX = -32f;
    pacmanX = mspacmanX - 32f * 5;
  }

  private void updateMiddleRight() {
    updateSpriteIndices();
    pacmanX += 3f;
    mspacmanX += 3f;
    if (pacmanX > 800 + 3 * 91) {
      initTopLeft();
    }
  }

  private void renderMiddleRight() {
    main.pacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(pacmanX, 284);
    main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(mspacmanX, 284);
  }

  private void initTopLeft() {
    state = STATE_TOP_LEFT;
    pacmanX = 800f;
    mspacmanX = pacmanX + 32f * 5;
  }

  private void updateTopLeft() {
    updateSpriteIndices();
    pacmanX -= 10f;
    mspacmanX -= 10f;
    if (mspacmanX < -32f) {
      initBottomRight();
    }
  }

  private void renderTopLeft() {
    main.pacmanSprites[Main.LEFT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(pacmanX, 184);
    main.mspacmanSprites[Main.LEFT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(mspacmanX, 184);
  }

  private void initBottomRight() {
    state = STATE_BOTTOM_RIGHT;
    mspacmanX = -32f;
    pacmanX = mspacmanX - 32f * 5;
  }

  private void updateBottomRight(GameContainer gc) throws SlickException {
    updateSpriteIndices();
    pacmanX += 10f;
    mspacmanX += 10f;
    if (pacmanX > 800 && !main.actMusic[1].playing()) {
      main.setMode(Main.playingMode, gc);
    }
  }

  private void renderBottomRight() {
    main.pacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(pacmanX, 384);
    main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(mspacmanX, 384);
  }

  private void updateClapper() {

    if (fadeState == FADE_IN) {
      if (--fadeIndex == 0) {
        fadeState = FADE_NONE;
      }
      return;
    } else if (!main.actMusic[1].playing()) {
      main.actMusic[1].play();
    }

    timer++;
    if (substate == 0) {
      if (timer == PAUSE_BEFORE_CLACK) {
        substate = 1;
        timer = 0;
      }
    } else if (substate == 4) {
      if (timer == PAUSE_AFTER_CLACK) {
        substate = 0;
        timer = 0;
        initTopRight();
      }
    } else if (timer == 8) {
      substate++;
      timer = 0;
    }

    switch(substate) {
      case 0:
      case 4:
        topClapperIndex = 0;
        break;
      case 1:
      case 3:
        topClapperIndex = 1;
        break;
      case 2:
        topClapperIndex = 2;
        break;
    }
  }

  private void renderClapper(GameContainer gc, Graphics g) {
    main.drawString("THE CHASE", 368, 272, Main.WHITE);
    main.clapperBottomSprite.draw(288, 275);
    main.drawString("2", 328, 288, Main.WHITE);
    main.clapperTopSprites[topClapperIndex].draw(288, 243);

    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
    }
  }

  private void updateSpriteIndices() {
    if (++chompSpriteIndexIncrementor == MsPacMan.CHOMP_SPEED) {
      chompSpriteIndexIncrementor = 0;
      if (++chompSpriteIndex == 4) {
        chompSpriteIndex = 0;
      }
    }
  }
}
