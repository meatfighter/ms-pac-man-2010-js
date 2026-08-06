package mspacman;

import org.newdawn.slick.*;

public class Act6Mode implements IMode {

  public static final int BUMP_OFFSET = 40;
  public static final int PAUSE_BEFORE_CLACK = 45;
  public static final int PAUSE_AFTER_CLACK = 45;

  public static final int STATE_CLAPPER = 0;
  public static final int STATE_RIGHT = 1;
  public static final int STATE_LEFT = 2;

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  private Main main;
  private int state;
  private int substate;
  private int topClapperIndex;
  private int timer;
  private int ghostSpriteIndex;
  private int ghostSpriteIndexIncrementor;
  private int chompSpriteIndex;
  private int chompSpriteIndexIncrementor;
  private int fadeIndex;
  private int fadeState;
  private float mspacmanX;
  private float ghostX;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;

    state = STATE_CLAPPER;
    timer = 0;
    substate = 0;
    topClapperIndex = 0;

    ghostSpriteIndex = 0;
    ghostSpriteIndexIncrementor = 0;
    chompSpriteIndex = 0;
    chompSpriteIndexIncrementor = 0;
    fadeIndex = 22;
    fadeState = FADE_IN;
  }

  public void update(GameContainer gc) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        updateClapper();
        break;
      case STATE_RIGHT:
        updateRight();
        break;
      case STATE_LEFT:
        updateLeft(gc);
        break;
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        renderClapper(gc, g);
        break;
      case STATE_RIGHT:
        renderRight(gc, g);
        break;
      case STATE_LEFT:
        renderLeft(gc, g);
        break;
    }
  }

  private void initRight() {
    state = STATE_RIGHT;

    ghostX = -(32 * 4 + 8 * 4);
    mspacmanX = ghostX - 32 * 7;
  }

  private void updateRight() {
    updateSpriteIndices();
    ghostX += 3f;
    mspacmanX += 3.5f;
    if (mspacmanX > 850) {
      initLeft();
    }
  }

  private void renderRight(GameContainer gc, Graphics g) throws SlickException {
    main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(mspacmanX, 284);
    main.blueGhostSprites[ghostSpriteIndex].draw(ghostX, 284);
    main.blueGhostSprites[ghostSpriteIndex].draw(ghostX + 32 + 8, 284);
    main.blueGhostSprites[ghostSpriteIndex].draw(ghostX + 32 * 2 + 8 * 2, 284);
    main.blueGhostSprites[ghostSpriteIndex].draw(ghostX + 32 * 3 + 8 * 3, 284);
  }

  private void initLeft() {
    state = STATE_LEFT;
    mspacmanX = 800;
    ghostX = mspacmanX + 32 * 10;
  }

  private void updateLeft(GameContainer gc) throws SlickException {
    updateSpriteIndices();
    mspacmanX -= 3f;
    ghostX -= 3.5f;
    if (ghostX < -256 * 4) {
      main.setMode(Main.playingMode, gc);
    }
  }

  private void renderLeft(GameContainer gc, Graphics g) throws SlickException {
    main.mspacmanSprites[Main.LEFT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(mspacmanX, 284);
    main.drawScaled(main.ghostSprites[Main.RED][Main.LEFT][ghostSpriteIndex],
        ghostX, 204, 8f);
    main.drawScaled(main.ghostSprites[Main.CYAN][Main.LEFT][ghostSpriteIndex],
        ghostX + 256, 204, 8f);
    main.drawScaled(main.ghostSprites[Main.PINK][Main.LEFT][ghostSpriteIndex],
        ghostX + 256 * 2, 204, 8f);
    main.drawScaled(main.ghostSprites[Main.ORANGE][Main.LEFT][ghostSpriteIndex],
        ghostX + 256 * 3, 204, 8f);
  }

  private void updateSpriteIndices() {
    if (++ghostSpriteIndexIncrementor == Ghost.FLUTTER_SPEED) {
      ghostSpriteIndexIncrementor = 0;
      if (++ghostSpriteIndex == 2) {
        ghostSpriteIndex = 0;
      }
    }

    if (++chompSpriteIndexIncrementor == MsPacMan.CHOMP_SPEED) {
      chompSpriteIndexIncrementor = 0;
      if (++chompSpriteIndex == 4) {
        chompSpriteIndex = 0;
      }
    }
  }

  private void updateClapper() {

    if (fadeState == FADE_IN) {
      if (--fadeIndex == 0) {
        fadeState = FADE_NONE;
      }
      return;
    } else if (!main.actMusic[0].playing()) {
      main.actMusic[0].play();
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
        initRight();
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

    // 64 [16] 16*LENGTH = 176

    main.drawString("REVENGE", 384, 272, Main.WHITE);
    main.clapperBottomSprite.draw(304, 275);
    main.drawString("6", 344, 288, Main.WHITE);
    main.clapperTopSprites[topClapperIndex].draw(304, 243);

    renderFade(gc, g);
  }

  private void renderFade(GameContainer gc, Graphics g) {
    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
    }
  }
}

