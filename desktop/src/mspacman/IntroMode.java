package mspacman;

import java.util.*;
import org.newdawn.slick.*;

public class IntroMode implements IMode {

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  private Main main;
  private Image whiteEnergizer;
  private float dotsOffset;
  private int redOffset;
  private int fadeIndex;
  private int fadeState;
  private float mspacmanX;
  private int ghostSpriteIndex;
  private int ghostSpriteIndexIncrementor;
  private int chompSpriteIndex;
  private int chompSpriteIndexIncrementor;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;

    main.random = new Random();
    main.stageIndex = 0;
    main.demoMode = false;
    main.score = 0;
    main.lives = 5;
    
    whiteEnergizer = main.tiles[0][49];
    dotsOffset = 0;
    fadeIndex = 22;
    fadeState = FADE_IN;
    mspacmanX = -32f;
    ghostSpriteIndex = 0;
    ghostSpriteIndexIncrementor = 0;
    chompSpriteIndex = 0;
    chompSpriteIndexIncrementor = 0;
    redOffset = 0;
  }

  public void update(GameContainer gc) throws SlickException {

    updateSpriteIndices();

    if (fadeState == FADE_IN) {
      if (--fadeIndex == 0) {
        fadeState = FADE_NONE;
        main.introMusic.play(); // 4.275 (389) seconds long
      }
    } else if (fadeState == FADE_OUT) {
      if (fadeIndex < 22) {
        fadeIndex++;
      } else {
        main.setMode(Main.playingMode, gc);
        return;
      }
      mspacmanX += 2.1388174807197943444730077120823f;
    } else {
      mspacmanX += 2.1388174807197943444730077120823f;
      if (mspacmanX >= 800) {
        fadeState = FADE_OUT;
        fadeIndex = 0;
      }
    }

    dotsOffset -= 3f;
    while(dotsOffset < -32) {
      dotsOffset += 32;
      redOffset++;
    }
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
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

    main.mspacmanSprites[Main.RIGHT][MsPacMan.spritePattern[chompSpriteIndex]]
        .draw(mspacmanX, 284);
    main.ghostSprites[Main.RED][Main.RIGHT][ghostSpriteIndex]
        .draw(mspacmanX - 32 * 3, 284);
    main.ghostSprites[Main.CYAN][Main.RIGHT][ghostSpriteIndex]
        .draw(mspacmanX - 32 * 4 - 8, 284);
    main.ghostSprites[Main.PINK][Main.RIGHT][ghostSpriteIndex]
        .draw(mspacmanX - 32 * 5 - 16, 284);
    main.ghostSprites[Main.ORANGE][Main.RIGHT][ghostSpriteIndex]
        .draw(mspacmanX - 32 * 6 - 24, 284);

    main.drawString("LET THE GAMES BEGIN!", 240, 16 * 5, Main.WHITE);

    renderFade(gc, g);
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
