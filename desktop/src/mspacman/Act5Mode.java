package mspacman;

import org.newdawn.slick.*;

public class Act5Mode implements IMode {

  public static final int PAUSE_STRING = 8;
  public static final int PAUSE_BETWEEN_STRINGS = 2 * 91;
  public static final int PAUSE_BEFORE_CLACK = 45;
  public static final int PAUSE_AFTER_CLACK = 45;

  public static final int STATE_CLAPPER = 0;
  public static final int STATE_TALKING = 1;

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  private static String[] dialog = {
    "\"THOSE STAGES ARE DIFFICULT!'",
    "\"HANG IN THERE.\n\n\nEATING PELLETS SLOWS YOU DOWN.\n\nWHEN BEING CHASED, HEAD FOR OPEN TERRITORY.\n\n\nALSO, TUNNELS SLOW GHOSTS DOWN.'",
    "\"THANKS FOR THE TIPS.'",
  };

  private Main main;
  private int state;
  private int substate;
  private int topClapperIndex;
  private int timer;
  private int fadeIndex;
  private int fadeState;
  private int dialogIndex;
  private int stringIndex;
  private boolean stringDone;
  private int stringTimer;
  private int tone;
  private int mspacmanIndex;
  private int pacmanIndex;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;

    state = STATE_CLAPPER;
    timer = 0;
    substate = 0;
    topClapperIndex = 0;
    fadeIndex = 22;
    fadeState = FADE_IN;
    dialogIndex = 0;
    stringIndex = 0;
    stringDone = false;
    stringTimer = 0;
    tone = 0;
    mspacmanIndex = 1;
    pacmanIndex = 1;
  }

  public void update(GameContainer gc) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        updateClapper();
        break;
      case STATE_TALKING:
        updateTalking(gc);
        break;
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    switch(state) {
      case STATE_CLAPPER:
        renderClapper(gc, g);
        break;
      case STATE_TALKING:
        renderTalking(gc, g);
        break;
    }
  }

  private void initString(int dialogIndex, int tone) {
    this.tone = tone;
    this.dialogIndex = dialogIndex;
    stringIndex = 0;
    stringTimer = 0;
    stringDone = false;
  }

  private void updateString() {
    if (++stringTimer == PAUSE_STRING) {
      stringTimer = 0;
      String s = dialog[dialogIndex];
      if (stringIndex < s.length()) {
        char c = s.charAt(stringIndex);
        if (c != ' ' && c != '\n') {
          main.speaking[tone][main.random.nextInt(10)].play();
          if (dialogIndex == 1) {
            mspacmanIndex = 1;
            pacmanIndex = main.random.nextInt(3);
          } else {
            pacmanIndex = 1;
            mspacmanIndex = main.random.nextInt(3);
          }
        } else {
          mspacmanIndex = 1;
          pacmanIndex = 1;
        }
        stringIndex++;
      } else {
        stringDone = true;
        mspacmanIndex = 1;
        pacmanIndex = 1;
      }
    }
  }

  private void renderString(float x, float y) {

    float X = x;
    String s = dialog[dialogIndex];
    Image[] symbols = main.symbols[Main.WHITE];

    for(int i = 0; i < stringIndex; i++, x += 16) {
      char c = s.charAt(i);
      if (c == '\n') {
        x = X;
        y += 16;
      } else if (c != ' ') {
        symbols[s.charAt(i)].draw(x, y);
      }
    }
  }

  private void initTalking() {
    state = STATE_TALKING;
    initString(0, 0);
  }

  private void updateTalking(GameContainer gc) throws SlickException {
    if (fadeState == FADE_OUT) {
      if (fadeIndex < 22) {
        fadeIndex++;
      } else {
        main.setMode(Main.playingMode, gc);
      }
    } else if (stringDone) {
      if (++stringTimer == PAUSE_BETWEEN_STRINGS) {
        if (dialogIndex < 2) {
          initString(dialogIndex + 1, tone == 0 ? 1 : 0);
        } else {
          fadeState = FADE_OUT;
          fadeIndex = 0;
        }
      }
    } else {
      updateString();
    }
  }

  private void renderTalking(GameContainer gc, Graphics g)
      throws SlickException {

    main.drawScaled(main.mspacmanSprites[Main.RIGHT][mspacmanIndex],
        32 * 10, 32 * 15, 4f);
    if (pacmanIndex == 2) {
      main.drawScaled(main.pacmanSprites[Main.LEFT][pacmanIndex],
          32 * 15 + 8, 32 * 15, 4f);
    } else {
      main.drawScaled(main.pacmanSprites[Main.LEFT][pacmanIndex],
          32 * 15, 32 * 15, 4f);
    }

    switch(dialogIndex) {
      case 0:
        renderString(168, 64);
        break;
      case 1:
        renderString(64, 64);
        break;
      case 2:
        renderString(224, 64);
        break;
    }

    renderFade(gc, g);
  }

  private void updateClapper() {

    if (fadeState == FADE_IN) {
      if (--fadeIndex == 0) {
        fadeState = FADE_NONE;
      }
      return;
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
        initTalking();
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

    // 64 [16] 16*LENGTH = 272
    main.drawString("COACHING", 376, 272, Main.WHITE);
    main.clapperBottomSprite.draw(296, 275);
    main.drawString("5", 336, 288, Main.WHITE);
    main.clapperTopSprites[topClapperIndex].draw(296, 243);

    renderFade(gc, g);
  }

  private void renderFade(GameContainer gc, Graphics g) {
    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
    }
  }
}
