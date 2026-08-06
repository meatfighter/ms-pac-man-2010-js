package mspacman;

import org.newdawn.slick.*;
import org.newdawn.slick.util.*;

public class Act1Mode implements IMode {

  public static final int BUMP_OFFSET = 40;
  public static final int PAUSE_BEFORE_CLACK = 45;
  public static final int PAUSE_AFTER_CLACK = 45;

  public static final int STATE_CLAPPER = 0;
  public static final int STATE_STACKED_CHASE = 1;
  public static final int STATE_HEAD_ON = 2;

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  private Main main;
  private int state;
  private int nextState;
  private int substate;
  private int topClapperIndex;
  private int timer;
  private float cyanX;
  private float pacmanX;
  private float pinkX;
  private float mspacmanX;
  private float mspacmanY;
  private int ghostSpriteIndex;
  private int ghostSpriteIndexIncrementor;
  private int chompSpriteIndex;
  private int chompSpriteIndexIncrementor;
  private boolean bumped;
  private boolean showHeart;
  private float bumpedAlpha;
  private float bumpedSpeed;
  private float ghostY;
  private float ghostYAngle;
  private int fadeIndex;
  private int fadeState;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;

    nextState = STATE_CLAPPER;
    timer = 0;
    substate = 0;
    topClapperIndex = 0;

    cyanX = 0;
    pacmanX = 0;
    pinkX = 0;
    mspacmanX = 0;
    ghostSpriteIndex = 0;
    ghostSpriteIndexIncrementor = 0;
    chompSpriteIndex = 0;
    chompSpriteIndexIncrementor = 0;
    mspacmanY = 0;
    bumped = false;
    showHeart = false;
    bumpedAlpha = 1f;
    bumpedSpeed = 2.125f;
    ghostY = 284f;
    ghostYAngle = 0;
    fadeIndex = 22;
    fadeState = FADE_IN;
  }

  public void update(GameContainer gc) throws SlickException {

    state = nextState;

    switch(state) {
      case STATE_CLAPPER:
        updateClapper();
        break;
      case STATE_STACKED_CHASE:
        updateStackedChase();
        break;
      case STATE_HEAD_ON:
        updateHeadOn(gc);
        break;
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        renderClapper(gc, g);
        break;
      case STATE_STACKED_CHASE:
        renderStackedChase(gc, g);
        break;
      case STATE_HEAD_ON:
        renderHeadOn(gc, g);
        break;
    }
  }

  private void updateHeadOn(GameContainer gc) throws SlickException {

    updateSpriteIndices();

    if (showHeart) {
      if (fadeState == FADE_OUT) {
        if (fadeIndex < 22) {
          fadeIndex++;
        } else {
          main.setMode(Main.playingMode, gc);
        }
      } else if (++timer == 91) {
        fadeState = FADE_OUT;
        fadeIndex = 0;
      }
    } else {
      if (bumped) {
        if (bumpedSpeed > 0) {
          cyanX += bumpedSpeed;
          pinkX -= bumpedSpeed;
          bumpedSpeed -= 0.08;
          bumpedAlpha -= 0.02125f;
          float dy = (float)FastTrig.sin(ghostYAngle);
          ghostYAngle += 0.15f;
          dy *= dy;
          ghostY = 284f - dy * 8;
        } else {
          showHeart = true;
          timer = 0;
        }
      } else if (mspacmanX >= 368) {
        mspacmanX = 368;
        pacmanX = 400;
        if (cyanX > 400) {
          mspacmanY -= 2f;
          cyanX -= 2.125f;
          pinkX += 2.125f;
        } else {
          bumped = true;
          bumpedAlpha = 1f;
        }
      } else {
        pacmanX -= 2f;
        cyanX -= 2.125f;

        mspacmanX += 2f;
        pinkX += 2.125f;
      }
    }
  }

  private void renderHeadOn(GameContainer gc, Graphics g) {

    if (showHeart) {

      main.pacmanSprites[Main.LEFT][1].draw(pacmanX, mspacmanY);
      main.mspacmanSprites[Main.RIGHT][1].draw(mspacmanX, mspacmanY);
      main.heartSprite.draw(384, mspacmanY - 32);

    } else {

      main.pacmanSprites[Main.LEFT][MsPacMan.spritePattern[chompSpriteIndex]]
          .draw(pacmanX, mspacmanY);

      main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
          .draw(mspacmanX, mspacmanY);

      if (bumped) {
        main.draw(main.ghostSprites[Main.CYAN][Main.LEFT][ghostSpriteIndex],
            cyanX, ghostY, bumpedAlpha);
        main.draw(main.ghostSprites[Main.PINK][Main.RIGHT][ghostSpriteIndex],
            pinkX, ghostY, bumpedAlpha);
      } else {
        main.ghostSprites[Main.CYAN][Main.LEFT][ghostSpriteIndex]
            .draw(cyanX, 284);
        main.ghostSprites[Main.PINK][Main.RIGHT][ghostSpriteIndex]
            .draw(pinkX, 284);
      }
    }

    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
    }
  }

  private void updateStackedChase() {

    updateSpriteIndices();

    pacmanX += 2f;
    cyanX += 2.125f;

    mspacmanX -= 2f;
    pinkX -= 2.125f;

    if (cyanX > 800) {
      nextState = STATE_HEAD_ON;
      pinkX = -128f - BUMP_OFFSET;
      mspacmanX = -32f;
      cyanX = 896f + BUMP_OFFSET;
      pacmanX = 800f;
      mspacmanY = 284f;
    }
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

  private void renderStackedChase(GameContainer gc, Graphics g) {
    main.pacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(pacmanX, 134);
    main.ghostSprites[Main.CYAN][Main.RIGHT][ghostSpriteIndex].draw(cyanX, 134);
    main.mspacmanSprites[Main.LEFT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(mspacmanX, 344);
    main.ghostSprites[Main.PINK][Main.LEFT][ghostSpriteIndex].draw(pinkX, 344);
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
        nextState = STATE_STACKED_CHASE;

        cyanX = -128f;
        pacmanX = -32f;
        pinkX = 896f;
        mspacmanX = 800f;
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
    main.drawString("THEY MEET", 368, 272, Main.WHITE);
    main.clapperBottomSprite.draw(288, 275);
    main.drawString("1", 328, 288, Main.WHITE);
    main.clapperTopSprites[topClapperIndex].draw(288, 243);

    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
    }
  }
}
