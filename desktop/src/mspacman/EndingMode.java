package mspacman;

import org.newdawn.slick.util.*;
import org.newdawn.slick.*;

public class EndingMode implements IMode {

  public static final int PAUSE_STRING = 8;
  public static final int PAUSE_BETWEEN_STRINGS = 2 * 91;
  public static final int PAUSE_BEFORE_CLACK = 45;
  public static final int PAUSE_AFTER_CLACK = 45;

  public static final int STATE_TEXT = 0;
  public static final int STATE_ENEMIES = 1;
  public static final int STATE_CREDITS = 2;
  public static final int STATE_PRESENTED = 3;

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  private static final String[] dialog = {
    "YOU WIN!",
    "AS THE AWARD CEREMONY BEGINS,",
    "THE CROWD CAN BE HEARD WHISPERING...",
    "\"WHERE IS THE CHAMPION...'",
    "\"WHERE IS MS. PAC-MAN...'",
    "WHERE IS MS. PAC-MAN AS HER ADMIRERS",
    "CHANT HER NAME...",
    "SHE IS ALREADY SEEKING THE NEXT CHALLENGE.",
    "CEREMONY MEANS NOTHING TO HER.",
    "THE GAME IS ALL.",

    "SHADOW / \"BLINKY'\n\n\nENEMY PROGRAMMER\n\n  MICHAEL BIRKEN", // 10
    "SPEEDY / \"PINKY'\n\n\nENEMY PROGRAMMER\n\n  MICHAEL BIRKEN",
    "BASHFUL / \"INKY'\n\n\nENEMY PROGRAMMER\n\n  MICHAEL BIRKEN",
    "POKEY / \"SUE'\n\n\nENEMY PROGRAMMER\n\n  MICHAEL BIRKEN",

    "  PRESENTED BY\n\nMEATFIGHTER.COM", // 14
  };
  private static float[] dialogX = new float[dialog.length];
  
  private static final String[] credits = {

    "CREATIVE STAFF",
    "",
    "",
    "GAME DESIGNER",
    "  MICHAEL BIRKEN",
    "",
    "PROGRAMMER",
    "  MICHAEL BIRKEN",
    "",
    "CHARACTER DESIGNER",
    "  MICHAEL BIRKEN",
    "",
    "STORY",
    "  MICHAEL BIRKEN",
    "",
    "SYSTEM DESIGNER",
    "  MICHAEL BIRKEN",
    "",
    "VISUAL DESIGNER",
    "  MICHAEL BIRKEN",
    "",
    "VRAM DESIGNER",
    "  MICHAEL BIRKEN",
    "",
    "OBJECT DESIGNER",
    "  MICHAEL BIRKEN",
    "",
    "TOTAL DIRECTOR",
    "  MICHAEL BIRKEN",
    "",
    "TECHNICAL ADVISOR",
    "  MICHAEL BIRKEN",
    "",
    "CODE GUY",
    "  MICHAEL BIRKEN",
    "",
    "",

    "INSPIRED BY THE BRILLIANT WORKS OF",
    "  NAMCO",
    "  MIDWAY",
    "  GENERAL COMPUTER CORPORATION",
    "  NINTENDO",
    "  CAPCOM",
    "",
    "",

    "MUSIC AND SOUNDS BORROWED FROM PAC-MANIA",
    "  JUNKO OZAWA",
    "  YURI.",
    "  Y.TOMURO",
    "",
    "",

    "MUSIC BORROWED FROM PUNCH-OUT!!",
    "  K.YAMAMOTO",
    "  Y.KANEOKA",
    "  A.NAKATUKA",
    "",
    "",

    "VERY SPECIAL THANKS",
    "  TORU IWATANI FOR INVENTING PAC-MAN",
    "",
    "",
    "",
    "",
    "",
    "",
    "  AND YOU!! THANKS FOR PLAYING!",
  };

  static {
    for(int i = 0; i < 10; i++) {
      dialogX[i] = (800f - dialog[i].length() * 16f) / 2f;
    }
    dialogX[10] = 340;
    dialogX[11] = 340;
    dialogX[12] = 340;
    dialogX[13] = 340;
    dialogX[14] = 280;
  }

  private Main main;
  private int state;
  private int fadeIndex;
  private int fadeState;
  private int dialogIndex;
  private int stringIndex;
  private boolean stringDone;
  private int stringTimer;
  private Image whiteEnergizer;
  private float dotsOffset;
  private int redOffset;
  private int fadeIndex2;
  private int fadeState2;
  private int ghostSpriteIndex;
  private int ghostSpriteIndexIncrementor;
  private int chompSpriteIndex;
  private int chompSpriteIndexIncrementor;
  private int delay;
  private float creditsY;
  private float mspacmanX;
  private boolean juniorReturning;
  private float juniorX;
  private boolean juniorFruits;
  private float[][] fruitData = new float[7][2]; // y, vy

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;

    whiteEnergizer = main.tiles[0][49];
    dotsOffset = 0;
    fadeIndex = 22;
    fadeState = FADE_IN;
    dialogIndex = 0;
    stringIndex = 0;
    stringDone = false;
    stringTimer = 0;
    redOffset = 0;
    fadeIndex2 = 0;
    fadeState2 = 0;
    ghostSpriteIndex = 0;
    ghostSpriteIndexIncrementor = 0;
    chompSpriteIndex = 0;
    chompSpriteIndexIncrementor = 0;
    creditsY = 0;
    mspacmanX = 0;
    juniorReturning = false;
    juniorX = 0;
    juniorFruits = false;

    float angle = 0f;
    for(int i = 0; i < fruitData.length; i++, angle += 2.1f) {
      fruitData[i][0] = -16f - 16f * (float)FastTrig.sin(angle);
    }

    initText();

    main.loopMusic(main.trainingMusic);
  }

  public void update(GameContainer gc) throws SlickException {
    switch(state) {
      case STATE_TEXT:
        updateText();
        break;
      case STATE_ENEMIES:
        updateEnemies();
        break;
      case STATE_CREDITS:
        updateCredits();
        break;
      case STATE_PRESENTED:
        updatePresented(gc);
        break;
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    switch(state) {
      case STATE_TEXT:
        renderText(gc, g);
        break;
      case STATE_ENEMIES:
        renderEnemies(gc, g);
        break;
      case STATE_CREDITS:
        renderCredits(gc, g);
        break;
      case STATE_PRESENTED:
        renderPresented(gc, g);
        break;
    }
  }

  private void initPresented() {
    state = STATE_PRESENTED;
    fadeIndex = 0;
    fadeState = FADE_NONE;
    initString(14);
    mspacmanX = -64f;
    juniorReturning = false;
    juniorFruits = false;
    delay = 0;
  }

  private void updatePresented(GameContainer gc) throws SlickException {

    if (delay > 0) {
      delay--;
    } else if (fadeState == FADE_OUT) {
      if (fadeIndex < 22) {
        fadeIndex++;
      } else {
        if (main.isHighScore()) {
          main.setMode(Main.enterInitialsMode, gc);
        } else {
          main.setMode(Main.attractMode, gc);
        }
      }
    } else if (stringDone) {
      updateSpriteIndices();

      mspacmanX += 1f;
      if (juniorFruits) {
        juniorX += 1f;
        if (juniorX > 1120) {
          main.fadeMusic();
          delay = 91;
          fadeState = FADE_OUT;
          fadeIndex = 0;
        }  
        for(int i = 0; i < 7; i++) {
          float[] fruit = fruitData[i];
          fruit[0] += fruit[1];
          fruit[1] += 0.1f;
          if (fruit[0] >= 0) {
            fruit[0] = 0f;
            fruit[1] = -2f;
          }
        }
      } else if (juniorReturning) {
        juniorX -= 3f;
        if (mspacmanX > 872) {
          juniorFruits = true;
          juniorX = -32f;
        }
      } else if (mspacmanX > 450) {
        juniorReturning = true;
        juniorX = mspacmanX - 80;
      }

    } else {
      updateString();
    }
  }

  private void renderPresented(
      GameContainer gc, Graphics g) throws SlickException {
    renderString();
    if (stringDone) {
      if (juniorFruits) {
        main.juniorRightSprite.draw(juniorX, 400);
        for(int i = 0; i < 7; i++) {
          main.fruitSprites[i].draw(juniorX - 40 * (i + 1),
              fruitData[i][0] + 408);
        }
      } else {
        main.mspacmanSprites
          [Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
          .draw(mspacmanX, 400);
        main.pacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
          .draw(mspacmanX - 40, 400);
        if (juniorReturning) {
          main.juniorSprite.draw(juniorX, 400);
        } else {
          main.juniorRightSprite.draw(mspacmanX - 80, 400);
        }
      }
    }

    renderFade(gc, g);
  }

  private void initCredits() {
    state = STATE_CREDITS;
    creditsY = 600f;
  }

  private void updateCredits() {
    creditsY -= 0.5f;
    if (creditsY + credits.length * 28 < 0) {
      initPresented();
    }
  }

  private void renderCredits(
      GameContainer gc, Graphics g) throws SlickException {

    for(int i = 0, y = 0; i < credits.length; i++, y += 28) {
      String s = credits[i];
      if (s.length() > 0) {
        main.drawString(s, 32, y + (int)creditsY,
            s.charAt(0) == ' ' ? Main.WHITE : Main.YELLOW);
      }
    }
  }

  private void initString(int dialogIndex) {
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
        stringIndex++;
      } else {
        stringDone = true;
      }
    }
  }

  private void renderString() {
    renderString(264);
  }

  private void renderString(float y) {

    float X = dialogX[dialogIndex];
    float x = X;
    String s = dialog[dialogIndex];
    int color = Main.WHITE;
    switch(dialogIndex) {
      case 10:
        color = Main.RED;
        break;
      case 11:
        color = Main.PINK;
        break;
      case 12:
        color = Main.CYAN;
        break;
      case 13:
        color = Main.ORANGE;
        break;
    }
    Image[] symbols = main.symbols[color];

    for(int i = 0; i < stringIndex; i++, x += 16) {
      char c = s.charAt(i);
      if (c == '\n') {
        symbols = main.symbols[Main.WHITE];
        x = X - 16;
        y += 16;
      } else if (c != ' ') {
        symbols[s.charAt(i)].draw(x, y);
      }
    }
  }

  private void initEnemies() {    
    state = STATE_ENEMIES;
    fadeIndex = 22;
    fadeState = FADE_IN;
    fadeIndex2 = 22;
    fadeState2 = FADE_IN;
    initString(10);
  }

  private void updateEnemies() {

    updateSpriteIndices();

    dotsOffset -= 3f;
    while(dotsOffset < -32) {
      dotsOffset += 32;
      redOffset++;
    }

    if (fadeState == FADE_IN) {
      if (--fadeIndex == 0) {
        fadeState = FADE_NONE;
      }
    } else if (fadeState == FADE_OUT) {
      if (fadeIndex < 22) {
        fadeIndex++;
      } else {
        initCredits();
      }
    } else if (fadeState2 == FADE_IN) {
      if (--fadeIndex2 == 0) {
        fadeState2 = FADE_NONE;
        delay = 45;
      }
    } else if (fadeState2 == FADE_OUT) {
      if (fadeIndex2 < 22) {
        fadeIndex2++;
      } else {
        if (dialogIndex == 13) {
          fadeIndex = 0;
          fadeState = FADE_OUT;
        } else {
          fadeIndex2 = 22;
          fadeState2 = FADE_IN;
          initString(dialogIndex + 1);
        }
      }
    } else if (delay > 0) {
      delay--;
      if (delay == 0 && stringDone) {
        fadeState2 = FADE_OUT;
        fadeIndex2 = 0;
      }
    } else if (stringDone) {
      delay = 91 * 2;
    } else {
      updateString();
    }
  }

  private void renderEnemies(
      GameContainer gc, Graphics g) throws SlickException {

    int enemy = Main.RED;
    switch(dialogIndex) {
      case 11:
        enemy = Main.PINK;
        break;
      case 12:
        enemy = Main.CYAN;
        break;
      case 13:
        enemy = Main.ORANGE;
        break;
    }    

    main.drawScaled(main.ghostSprites[enemy][Main.RIGHT][ghostSpriteIndex],
        200, 280, 4f);
    renderString(240);

    renderFade2(gc, g);

    float x = dotsOffset;
    for(int i = 0; i < 26; i++, x += 32) {
      if (((i + redOffset) % 10) == 0) {
        main.redEnergizerSprite.draw(x, 172);
        main.redEnergizerSprite.draw(x, 412);
      } else {
        whiteEnergizer.draw(x, 172);
        whiteEnergizer.draw(x, 412);
      }
    }

    renderFade(gc, g);
  }

  private void initText() {
    state = STATE_TEXT;
    initString(0);
  }

  private void updateText() {
    if (fadeState == FADE_IN) {
      if (--fadeIndex == 0) {
        fadeState = FADE_NONE;
      }
    } else if (fadeState == FADE_OUT) {
      if (fadeIndex < 22) {
        fadeIndex++;
      } else {
        initEnemies();
      }
    } else if (stringDone) {
      if (++stringTimer == PAUSE_BETWEEN_STRINGS) {
        if (dialogIndex != 9) {
          initString(dialogIndex + 1);
        } else {
          fadeState = FADE_OUT;
          fadeIndex = 0;
        }
      }
    } else {
      updateString();
    }
  }

  private void renderText(GameContainer gc, Graphics g)
      throws SlickException {

    main.drawScaled(main.mspacmanSprites[Main.RIGHT][1],
        400, 32 * 15, 4f);

    renderString();

    renderFade(gc, g);
  }

  private void renderFade2(GameContainer gc, Graphics g) {
    if (fadeState2 != FADE_NONE) {
      g.setColor(main.fades[fadeIndex2]);
      g.fillRect(0, 172, 800, 240);
    }
  }

  private void renderFade(GameContainer gc, Graphics g) {
    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
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
}
