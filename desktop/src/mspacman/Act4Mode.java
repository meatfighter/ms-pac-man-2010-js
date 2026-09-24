package mspacman;

import org.newdawn.slick.*;
import org.newdawn.slick.util.*;

public class Act4Mode implements IMode {

  public static final int PAUSE_CENTERED = 4 * 91;
  public static final int PAUSE_BEFORE_CLACK = 45;
  public static final int PAUSE_AFTER_CLACK = 45;

  public static final int STATE_CLAPPER = 0;
  public static final int STATE_TRAINING = 1;

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
  private int chompSpriteIndex;
  private int chompSpriteIndexIncrementor;
  private int storkSpriteIndex;
  private int storkSpriteIndexIncrementor;
  private float pellotOffset;
  private float storkX;
  private float storkY;
  private float storkYAngle;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;

    state = STATE_CLAPPER;
    timer = 0;
    substate = 0;
    topClapperIndex = 0;
    fadeIndex = 22;
    fadeState = FADE_IN;
    chompSpriteIndex = 0;
    chompSpriteIndexIncrementor = 0;
    storkSpriteIndex = 0;
    storkSpriteIndexIncrementor = 0;
    pellotOffset = 0f;
    mspacmanX = 0;
    storkX = 0;
    storkY = 0;
    storkYAngle = 0;
  }

  public void update(GameContainer gc) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        updateClapper();
        break;
      case STATE_TRAINING:
        updateTraining(gc);
        break;
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        renderClapper(gc, g);
        break;
      case STATE_TRAINING:
        renderTraining(gc, g);
        break;
    }
  }

  private void initTraining() {
    state = STATE_TRAINING;
    mspacmanX = 800 + 32 * 7;
    storkX = mspacmanX - 32 * 7;
    pellotOffset = 0;
    timer = 0;
  }

  private void updateTraining(GameContainer gc) throws SlickException {
    updateSpriteIndices();
    if (mspacmanX > 384) {
      mspacmanX -= 0.25f;
    } else {
      mspacmanX = 384;
      timer++;
      if (fadeState == FADE_OUT) {
        if (fadeIndex < 22) {
          fadeIndex++;
        } else {
          main.setMode(Main.playingMode, gc);
          return;
        }
      }
      if (timer == PAUSE_CENTERED) {
        main.fadeMusic();
      } else if (timer == PAUSE_CENTERED + 68) {
        fadeState = FADE_OUT;
        fadeIndex = 0;
      }
    }
    pellotOffset += 2f;
    if (pellotOffset > 16f) {
      pellotOffset -= 16f;
    }

    storkX = mspacmanX - 32 * 7;
    storkY = 384 - 32 * 4 + 16 * (float)FastTrig.sin(storkYAngle);
    storkYAngle += 0.01f;
  }

  private void renderTraining(
      GameContainer gc, Graphics g) throws SlickException {
    for(int x = -16; x < 816; x += 16) {
      float X = x + pellotOffset;
      if (X > mspacmanX + 16) {
        break;
      }
      main.tiles[0][48].draw(X, 392);
    }
    main.mspacmanSprites[Main.LEFT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(mspacmanX, 384);

    main.pacmanSprites[Main.LEFT][1].draw(storkX + 28, storkY - 18);
    main.storkHeadSprite.draw(storkX, storkY);
    main.storkWingsSprites[storkSpriteIndex].draw(storkX + 32, storkY);

    renderFade(gc, g);
  }

  private void updateClapper() {

    if (fadeState == FADE_IN) {
      if (--fadeIndex == 0) {
        fadeState = FADE_NONE;
      }
      return;
    } else if (!main.trainingMusic.playing()) {
      main.loopMusic(main.trainingMusic);
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
        initTraining();
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

    // 64 [16] 16*LENGTH = 208
    main.drawString("TRAINING", 376, 272, Main.WHITE);
    main.clapperBottomSprite.draw(296, 275);
    main.drawString("4", 336, 288, Main.WHITE);
    main.clapperTopSprites[topClapperIndex].draw(296, 243);

    renderFade(gc, g);
  }

  private void renderFade(GameContainer gc, Graphics g) {
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
    if (++storkSpriteIndexIncrementor == 12) {
      storkSpriteIndexIncrementor = 0;
      if (++storkSpriteIndex == 2) {
        storkSpriteIndex = 0;
      }
    }
  }
}

