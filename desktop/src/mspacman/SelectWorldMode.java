package mspacman;

import org.newdawn.slick.*;
import org.newdawn.slick.util.*;

public class SelectWorldMode implements IMode {

  public static final int RED_INTERVAL = 5;
  public static final int LIGHTS = RED_INTERVAL * 10;
  public static final float ANGLE_INC = (float)(2.0 * Math.PI / LIGHTS);
  public static final int SELECTION_STEPS = 22;
  public static final float SELECT_INC
      = (float)(Math.PI / (2 * SELECTION_STEPS));

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  private Main main;
  private int fadeIndex;
  private int fadeState;
  private IInput input;
  private int ghostSpriteIndex;
  private int ghostSpriteIndexIncrementor;
  private Image whiteEnergizer;
  private float angleOffset;
  private int selection;
  private float selectY;
  private boolean selecting;
  private float selectOffset;
  private float selectAngle;
  private float selectMag;
  private int selectIndex;
  private int countDown;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;
    this.input = main.input;

    whiteEnergizer = main.tiles[0][49];
    fadeIndex = 22;
    fadeState = FADE_IN;
    ghostSpriteIndex = 0;
    ghostSpriteIndexIncrementor = 0;
    angleOffset = 0;
    selection = 0;
    selectY = 143f;
    selecting = false;
    selectOffset = 0;
    selectAngle = 0;
    selectMag = 0;
    selectIndex = 0;
    countDown = 0;

    input.clearKeyPressedRecord();

    main.loopMusic(main.levelSelectMusic);
  }

  public void update(GameContainer gc) throws SlickException {

    angleOffset += 0.01;

    if (++ghostSpriteIndexIncrementor == Ghost.FLUTTER_SPEED) {
      ghostSpriteIndexIncrementor = 0;
      if (++ghostSpriteIndex == 2) {
        ghostSpriteIndex = 0;
      }
    }

    if (fadeState == FADE_IN) {
      if (--fadeIndex == 0) {
        fadeState = FADE_NONE;
      }
    } else if (fadeState == FADE_OUT) {
      if (fadeIndex < 22) {
        fadeIndex++;
      } else {
        main.stopAllSounds();
        main.worldIndex = selection;
        main.setMode(Main.introMode, gc);
      }
    } else {
      if (countDown > 0) {
        if (--countDown == 0) {
          fadeState = FADE_OUT;
          fadeIndex = 0;
        }
      } else if (selecting) {
        if (selectIndex < SELECTION_STEPS) {
          selectIndex++;
          selectAngle += SELECT_INC;
          selectY = selectOffset + selectMag * (float)FastTrig.sin(selectAngle);
        } else {
          selectIndex = 0;
          selecting = false;
        }
      } else {
        selectY = 143f + (selection << 7);
        if (selection > 0 && input.isUp()) {
          selection--;
          selecting = true;
          selectOffset = selectY;
          selectAngle = 0;
          selectMag = -128f;
          selectIndex = 0;
        } else if (selection < 3 && input.isDown()) {
          selection++;
          selecting = true;
          selectOffset = selectY;
          selectAngle = 0;
          selectMag = 128f;
          selectIndex = 0;
        } else if (input.isConfirmPressed()) {
          main.playSound(main.pressedEnterSound);
          countDown = 60;
        }
      }
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    main.drawString("SELECT GAME WORLD", 264, 32, Main.YELLOW);
    main.drawString("BLINKYS WORLD", 296, 143, Main.RED);
    main.drawString("PINKYS WORLD", 296, 271, Main.PINK);
    main.drawString("INKYS WORLD", 296, 399, Main.CYAN);
    main.drawString("SUES WORLD", 296, 527, Main.ORANGE);

    if (!selecting) {
      switch(selection) {
        case 0:
          main.ghostSprites[Main.RED][Main.RIGHT][ghostSpriteIndex]
              .draw(240, 135);
          break;
        case 1:
          main.ghostSprites[Main.PINK][Main.RIGHT][ghostSpriteIndex]
              .draw(240, 263);
          break;
        case 2:
          main.ghostSprites[Main.CYAN][Main.RIGHT][ghostSpriteIndex]
              .draw(240, 391);
          break;
        case 3:
          main.ghostSprites[Main.ORANGE][Main.RIGHT][ghostSpriteIndex]
              .draw(240, 519);
          break;          
      }
    }

    float angle = angleOffset;
    for(int i = 0, j = 0; i < LIGHTS; i++, angle += ANGLE_INC) {
      float x = 392f + 300f * (float)FastTrig.cos(angle);
      float y = selectY + 32f * (float)FastTrig.sin(angle);
      if (++j == RED_INTERVAL) {
        j = 0;
        main.redEnergizerSprite.draw(x, y);
      } else {
        whiteEnergizer.draw(x, y);
      }
    }

    renderFade(gc, g);
  }

  private void renderFade(GameContainer gc, Graphics g) {
    if (fadeState != FADE_NONE) {
      g.setColor(main.fades[fadeIndex]);
      g.fillRect(0, 0, 800, 600);
    }
  }
}
