package mspacman;

import org.newdawn.slick.*;

public class Act3Mode implements IMode {

  public static final int PAUSE_BEFORE_CLACK = 45;
  public static final int PAUSE_AFTER_CLACK = 45;

  public static final int STATE_CLAPPER = 0;
  public static final int STATE_CARRYING = 1;
  public static final int STATE_DROPPING = 2;
  public static final int STATE_JUNIOR = 3;

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
  private float storkX;
  private int storkSpriteIndex;
  private int storkSpriteIndexIncrementor;
  private float juniorBagX;
  private float juniorBagY;
  private float juniorBagVy;
  private float juniorY;
  private float juniorVy;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;

    state = STATE_CLAPPER;
    timer = 0;
    substate = 0;
    topClapperIndex = 0;
    fadeIndex = 22;
    fadeState = FADE_IN;
    storkSpriteIndex = 0;
    storkSpriteIndexIncrementor = 0;
    juniorBagVy = 0f;
    juniorY = 500;
    juniorVy = -4f;
  }

  public void update(GameContainer gc) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        updateClapper();
        break;
      case STATE_CARRYING:
        updateCarrying();
        break;
      case STATE_DROPPING:
        updateDropping();
        break;
      case STATE_JUNIOR:
        updateJunior(gc);
        break;
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        renderClapper(gc, g);
        break;
      case STATE_CARRYING:
        renderCarrying(gc, g);
        break;
      case STATE_DROPPING:
        renderDropping(gc, g);
        break;
      case STATE_JUNIOR:
        renderJunior(gc, g);
        break;
    }
  }

  private void initCarrying() {
    state = STATE_CARRYING;
    storkX = 800;
  }

  private void updateCarrying() {
    moveStork();
    if (storkX < 530) {
      initDropping();
    }
  }

  private void renderCarrying(GameContainer gc, Graphics g)
      throws SlickException {
    renderSprites();
    main.juniorBagSprite.draw(storkX, 100);
  }

  private void initDropping() {
    state = STATE_DROPPING;
    juniorBagX = storkX;
    juniorBagY = 100f;
  }

  private void updateDropping() {
    moveStork();
    juniorBagX -= 1f;
    juniorBagVy += 0.1f;
    juniorBagY += juniorBagVy;
    if (juniorBagY >= 500f) {
      if (juniorBagX < 32 * 9) {
        initJunior();
      } else {
        juniorBagY = 500f;
        juniorBagVy = -juniorBagVy * 0.5f;
      }
    }
  }

  private void renderDropping(GameContainer gc, Graphics g)
      throws SlickException {
    renderSprites();
    main.juniorBagSprite.draw(juniorBagX, juniorBagY); 
  }

  private void initJunior() {
    state = STATE_JUNIOR;
  }

  private void updateJunior(GameContainer gc) throws SlickException {
    moveStork();
    juniorVy += 0.1f;
    juniorY += juniorVy;
    if (juniorVy > 0 && juniorY >= 500) {
      juniorY = 500;
      if (fadeState == FADE_NONE && storkX <= -41) {
        fadeState = FADE_OUT;
      }
    }
    if (fadeState == FADE_OUT) {
      if (fadeIndex < 22) {
        fadeIndex++;
      } else {
        main.setMode(Main.playingMode, gc);
      }
    }
  }

  private void renderJunior(GameContainer gc, Graphics g)
      throws SlickException {
    renderSprites();
    main.juniorSprite.draw(juniorBagX - 5, juniorY);
    renderFade(gc, g);
  }

  private void updateClapper() {

    if (fadeState == FADE_IN) {
      if (--fadeIndex == 0) {
        fadeState = FADE_NONE;
      }
      return;
    } else if (!main.actMusic[2].playing()) {
      main.actMusic[2].play();
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
        initCarrying();
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

    main.drawString("JUNIOR", 392, 272, Main.WHITE);
    main.clapperBottomSprite.draw(312, 275);
    main.drawString("3", 352, 288, Main.WHITE);
    main.clapperTopSprites[topClapperIndex].draw(312, 243);

    renderFade(gc, g);
  }

  private void renderFade(GameContainer gc, Graphics g) {
    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
    }
  }

  private void moveStork() {
    storkX -= 1f;
    if (++storkSpriteIndexIncrementor == 12) {
      storkSpriteIndexIncrementor = 0;
      if (++storkSpriteIndex == 2) {
        storkSpriteIndex = 0;
      }
    }
  }

  private void renderSprites() {
    main.pacmanSprites[Main.RIGHT][1].draw(32 * 6, 500);
    main.mspacmanSprites[Main.RIGHT][1].draw(32 * 7, 500);
    main.storkHeadSprite.draw(storkX, 100);
    main.storkWingsSprites[storkSpriteIndex].draw(storkX + 31, 100);
  }
}
