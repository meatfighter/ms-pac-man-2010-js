package mspacman;

import org.newdawn.slick.*;
import java.util.*;

public class PlayingMode implements IMode {

  public static final int FADE_NONE = 0;
  public static final int FADE_IN = 1;
  public static final int FADE_OUT = 2;

  public static final int FADE_REASON_KILLED = 0;
  public static final int FADE_REASON_ADVANCE = 1;
  public static final int FADE_REASON_GAME_OVER = 2;

  public static final int TYPE_EMPTY = 0;
  public static final int TYPE_PELLOT = 1;
  public static final int TYPE_ENERGIZER = 2;
  public static final int TYPE_WALL = 3;

  public Main main;
  public float pelletCountFraction;
  public int pelletCount;
  public int pelletsRemaining;
  public int[][] regionMap;
  public int[][] tileMap = new int[31][28];
  public int[][] typeMap = new int[31][28];
  public int[][] homeTree;
  public int[][][] leftExitMaps;
  public int[][][] rightExitMaps;
  public Image[] tiles;
  public IInput input;
  public FruitTarget fruitTarget;
  public MsPacMan mspacman;
  public Ghost[] ghosts = new Ghost[4];
  public int[] regionCounts;
  public int exitIndex = 1;
  public int exitDelay;
  public boolean chaseMode = false;
  public int chaseModeToggleDelay;
  public boolean ghostsBlue;
  public int ghostsBlueOffset;
  public int ghostsBlueTimer;
  public boolean showGhostPoints;
  public int showGhostPointsTimer;
  public int ghostPointsIndex = -1;
  public Ghost eatenGhost;
  public int[][] energizerLocations = new int[4][2];
  public boolean energizersVisible;
  public int energizersVisibleTimer;
  public boolean finished;
  public int finishedTimer;
  public boolean finishedWhite;
  public int finishedBlinkTimer;
  public boolean fruitTargetPresent;
  public int fruitTargetTimer;
  public int[][] fruitTargetEntries;
  public boolean redEnergizerPresent;
  public boolean greenEnergizerPresent;
  public int energizerTimer;
  public boolean playerKilled;
  public int musicFadeOutTimer;
  public boolean playerSpiraling;
  public int spiralTimer;
  public int readyTimer;
  public String stageMessage;
  public float fruitOdds;
  public float redPelletOdds;
  public int exitDelayTarget;
  public int fadeIndex;
  public int fadeState;
  public int fadeReason;
  public boolean gameOver;
  public int gameOverTimer;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;

    if (main.demoMode) {
      main.random = new Random(0xCAFEBABE);
      input = main.robotInputs[main.demoIndex];
      input.reset();
      main.stageIndex = main.demoIndex;
      main.worldIndex = main.demoIndex;
      main.lives = 5;
      if (++main.demoIndex == 4) {
        main.demoIndex = 0;
      }
    } else {
      input = main.input;
    }

    tiles = main.tiles[main.stageIndex];
    Stage stage = main.stages[main.worldIndex][main.stageIndex];
    stageMessage = "STAGE " + (main.stageIndex + 1) + " OF 8";

    pelletsRemaining = pelletCount = stage.pelletCount;
    pelletCountFraction = 1f / pelletCount;

    regionCounts = new int[stage.regionCount];
    leftExitMaps = stage.leftExitMaps;
    rightExitMaps = stage.rightExitMaps;

    ArrayList<int[]> fruitTargetEntriesList = new ArrayList<int[]>();

    regionMap = stage.regionMap;
    int energizerLocationsIndex = 0;
    for(int i = 0; i < 31; i++) {
      System.arraycopy(stage.tileMap[i], 0, tileMap[i], 0, 28);
      for(int j = 0; j < 28; j++) {
        int tile = tileMap[i][j];
        switch(tile) {
          case 47:
            typeMap[i][j] = TYPE_EMPTY;
            if ((i == 0 || i == 31 || j == 0 || j == 27)
                && regionMap[i][j] > 0) {
              fruitTargetEntriesList.add(new int[] { j, i } );
            }
            break;
          case 48:
            typeMap[i][j] = TYPE_PELLOT;
            break;
          case 49:
            typeMap[i][j] = TYPE_ENERGIZER;
            energizerLocations[energizerLocationsIndex][0] = j;
            energizerLocations[energizerLocationsIndex][1] = i;            
            energizerLocationsIndex++;
            break;
          default:
            typeMap[i][j] = TYPE_WALL;
            break;
        }
      }
    }

    fruitTargetEntries = new int[fruitTargetEntriesList.size()][];
    fruitTargetEntriesList.toArray(fruitTargetEntries);

    homeTree = stage.homeTree;

    if (mspacman == null) {
      mspacman = new MsPacMan(this);
      ghosts[Main.RED] = new RedGhost(this);
      ghosts[Main.PINK] = new PinkGhost(this);
      ghosts[Main.CYAN] = new CyanGhost(this);
      ghosts[Main.ORANGE] = new OrangeGhost(this);
      fruitTarget = new FruitTarget(this);
    }

    reset();    
  }

  public void reset() {
    exitIndex = 1;
    exitDelay = 0;
    chaseMode = false;
    chaseModeToggleDelay = 0;
    ghostsBlue = false;
    ghostsBlueOffset = 0;
    ghostsBlueTimer = 0;
    showGhostPoints = false;
    showGhostPointsTimer = 0;
    ghostPointsIndex = -1;
    eatenGhost = null;
    energizersVisible = false;
    energizersVisibleTimer = 0;
    finished = false;
    finishedTimer = 0;
    finishedWhite = false;
    finishedBlinkTimer = 0;
    fruitTargetPresent = false;
    fruitTargetTimer = 0;
    redEnergizerPresent = false;
    greenEnergizerPresent = false;
    energizerTimer = 0;
    playerKilled = false;
    musicFadeOutTimer = 0;
    playerSpiraling = false;
    spiralTimer = 0;
    readyTimer = 91;
    fruitOdds = 0.5f - 0.25f * main.stageIndex / 7f;
    redPelletOdds = fruitOdds / 2f;
    exitDelayTarget = (int)(91 * (3f - 2.75f * main.stageIndex / 7f));
    fadeIndex = 0;
    fadeState = FADE_IN;
    fadeReason = FADE_REASON_KILLED;
    gameOver = false;
    gameOverTimer = 0;

    for(int i = regionCounts.length - 1; i >= 0; i--) {
      regionCounts[i] = 0;
    }

    mspacman.reset();
    ghosts[Main.RED].reset();
    ghosts[Main.PINK].reset();
    ghosts[Main.CYAN].reset();
    ghosts[Main.ORANGE].reset();
    fruitTarget.reset();

    incrementRegionCount(ghosts[Main.RED]);
    incrementRegionCount(ghosts[Main.PINK]);
    incrementRegionCount(ghosts[Main.CYAN]);
    incrementRegionCount(ghosts[Main.ORANGE]);

    main.loopMusic(main.stageMusic[main.stageIndex & 3]);
  }

  public void playerKilled() {

    playerKilled = true;
    musicFadeOutTimer = 0;
    playerSpiraling = false;
    spiralTimer = 0;
    main.stopAllSoundEffects();
    main.fadeMusic();
  }

  public void ghostEaten(Ghost ghost) {
    eatenGhost = ghost;
    showGhostPoints = true;
    showGhostPointsTimer = 91;
    eatenGhost.eyeBalls = true;
    ghostPointsIndex++;
    switch(ghostPointsIndex) {
      case 0:
        addPoints(200);
        break;
      case 1:
        addPoints(400);
        break;
      case 2:
        addPoints(800);
        break;
      case 3:
        addPoints(1600);
        break;
    }
    main.playSound(main.ateGhostSound);
  }

  public void atePellot() {
    addPoints(10);
    if (--pelletsRemaining == 0) {
      main.stopAllSounds();
      main.playSound(main.clappingSound);
      finished = true;
      finishedTimer = 0;
    }
  }

  public void ateEnergizer(int time) {
    addPoints(50);
    if (ghostsBlue) {
      ghostsBlueTimer += time;
    } else {
      ghostPointsIndex = -1;
      main.playSound(main.ateEnergizerSound);
      main.playSound(main.blueGhostsSound);
      ghostsBlue = true;
      ghostsBlueTimer = time;
      ghostsBlueOffset = 0;
      for(int i = 0; i < 4; i++) {
        if (!ghosts[i].eyeBalls) {
          ghosts[i].reverseDirection();
          ghosts[i].blue = true;
        }
      }
    }
  }

  public void ateEnergizer() {
    addPoints(50);
    ghostPointsIndex = -1;
    main.playSound(main.ateEnergizerSound);
    main.playSound(main.blueGhostsSound);
    ghostsBlue = true;
    ghostsBlueTimer = (int)(91 * (2 + (4 * (1.0f - main.stageIndex / 7.0f))));
    if (ghostsBlueTimer < 5) {
      ghostsBlueTimer = 5;
    }
    ghostsBlueOffset = 0;
    for(int i = 0; i < 4; i++) {
      if (!ghosts[i].eyeBalls) {
        ghosts[i].reverseDirection();
        ghosts[i].blue = true;
      }
    }
  }

  public void addPoints(int points) {
    int score = main.score;
    main.score += points;
    if (main.lives < 6 && score / 10000 != main.score / 10000) {
      main.playSound(main.extraLifeSound);
      main.lives++;
    }
  }

  public int getRegionCount(int x, int y) {

    int tx = x >> 4;
    int ty = y >> 4;
    if (tx < 0) {
      tx += 28;
    } else if (tx >= 28) {
      tx -= 28;
    }
    if (ty < 0) {
      ty += 31;
    } else if (ty >= 31) {
      ty -= 31;
    }

    int r = regionMap[ty][tx];
    if (r > 0) {
      return regionCounts[r];
    }

    return 0;
  }

  public void incrementRegionCount(Ghost ghost) {

    int x = ghost.x;
    int y = ghost.y;

    int tx = x >> 4;
    int ty = y >> 4;
    if (tx < 0) {
      tx += 28;
    } else if (tx >= 28) {
      tx -= 28;
    }
    if (ty < 0) {
      ty += 31;
    } else if (ty >= 31) {
      ty -= 31;
    }

    int r = regionMap[ty][tx];
    if (r > 0) {
      regionCounts[r]++;      
    }
  }

  public void decrementRegionCount(Ghost ghost) {

    int x = ghost.x;
    int y = ghost.y;

    int tx = x >> 4;
    int ty = y >> 4;
    if (tx < 0) {
      tx += 28;
    } else if (tx >= 28) {
      tx -= 28;
    }
    if (ty < 0) {
      ty += 31;
    } else if (ty >= 31) {
      ty -= 31;
    }

    int r = regionMap[ty][tx];
    if (r > 0) {
      if (regionCounts[r] > 0) {
        regionCounts[r]--;
      }
    }
  }

  public void update(GameContainer gc) throws SlickException {

    if (main.demoMode) {
      if (main.input.isConfirmPressed()) {
        main.stopAllSoundEffects();
        main.demoMode = false;
        main.playSound(main.pressedEnterSound);
        main.setMode(Main.selectWorldMode, gc);
        return;
      }
    }

    if (gameOver) {
      if (gameOverTimer < 5 * 91) {
        gameOverTimer++;
      } else {
        gameOver = false;
        gameOverTimer = 0;
        fadeIndex = 0;
        fadeState = FADE_OUT;
        fadeReason = FADE_REASON_GAME_OVER;
      }
      return;
    } else if (fadeState == FADE_IN) {
      if (fadeIndex > 0) {
        fadeIndex--;
      } else {
        fadeState = FADE_NONE;
      }
      return;
    } else if (fadeState == FADE_OUT) {
      if (fadeIndex < 22) {
        fadeIndex++;
      } else {
        switch(fadeReason) {
          case FADE_REASON_KILLED:
            if (main.demoMode) {
              main.stopAllSoundEffects();
              main.demoMode = false;
              main.setMode(Main.hallOfFameMode, gc);
            } else {
              main.lives--;
              reset();
            }
            break;
          case FADE_REASON_ADVANCE:
            main.advanceStage(gc);
            break;
          case FADE_REASON_GAME_OVER:
            if (main.isHighScore()) {
              main.setMode(Main.enterInitialsMode, gc);
            } else {
              main.setMode(Main.attractMode, gc);
            }
            break;
        }
      }
      return;
    }

    if (readyTimer > 0) {
      readyTimer--;
      return;
    }

    if (finished) {
      if (++finishedBlinkTimer == 23) {
        finishedBlinkTimer = 0;
        finishedWhite = !finishedWhite;
      }
      if (++finishedTimer == 600) {
        fadeIndex = 22;
        fadeState = FADE_OUT;
        fadeReason = FADE_REASON_ADVANCE;
      }
      return;
    }

    if (playerKilled) {
      if (musicFadeOutTimer < 91) {
        musicFadeOutTimer++;
        if (musicFadeOutTimer == 91) {
          main.playSound(main.diedSound);
          playerSpiraling = true;
          spiralTimer = 0;
        }
      } else if (spiralTimer < 91 * 2) {
        spiralTimer++;
      } else {
        if (main.lives > 0) {
          fadeState = FADE_OUT;
          fadeIndex = 0;
          fadeReason = FADE_REASON_KILLED;
        } else {
          gameOver = true;
          gameOverTimer = 0;
          main.playMusic(main.gameOverMusic);
        }
      }
      return;
    }

    if (++energizersVisibleTimer == 23) {
      energizersVisibleTimer = 0;
      energizersVisible = !energizersVisible;
    }
    
    if (exitIndex != 4) {
      if (++exitDelay == exitDelayTarget) {
        exitDelay = 0;
        ghosts[exitIndex++].exitingHome = true;
      }
    }

    if (showGhostPoints) {
      if (--showGhostPointsTimer == 0) {
        showGhostPoints = false;
        eatenGhost = null;
      }
    } else if (ghostsBlue) {
      if (ghostsBlueTimer <= 22
          || (ghostsBlueTimer >= 45 && ghostsBlueTimer <= 67)
          || (ghostsBlueTimer >= 91 && ghostsBlueTimer <= 113)
          || (ghostsBlueTimer >= 135 && ghostsBlueTimer <= 157)) {
        ghostsBlueOffset = 2;
      } else {
        ghostsBlueOffset = 0;
      }
      if (--ghostsBlueTimer == 0) {
        ghostPointsIndex = -1;
        ghostsBlue = false;
        main.stopSound(main.blueGhostsSound);
        for(int i = 0; i < 4; i++) {
          ghosts[i].blue = false;
        }
      }
    } else {
      chaseModeToggleDelay++;
      if (chaseMode) {
        if (chaseModeToggleDelay >= 20 * 91) {
          chaseModeToggleDelay = 0;
          chaseMode = false;
          for(int i = 0; i < 4; i++) {
            if (!ghosts[i].eyeBalls) {
              ghosts[i].reverseDirection();
            }
          }
        }
      } else {
        if (chaseModeToggleDelay >= 7 * 91) {
          chaseModeToggleDelay = 0;
          chaseMode = true;
        }
      }
    }
    
    mspacman.update(gc);

    ghosts[Main.RED].update(gc);
    ghosts[Main.PINK].update(gc);
    ghosts[Main.CYAN].update(gc);
    ghosts[Main.ORANGE].update(gc);

    if (redEnergizerPresent) {
      if (++energizerTimer == 7 * 91) {
        redEnergizerPresent = false;
      }
      if (distance(mspacman.x, mspacman.y, 16 * 13 + 8, 16 * 23) < 400) {
        redEnergizerPresent = false;
        ateEnergizer(2 * 91);
      }
    } else if (greenEnergizerPresent) {
      if (++energizerTimer == 7 * 91) {
        greenEnergizerPresent = false;
      }
      if (distance(mspacman.x, mspacman.y, 16 * 13 + 8, 16 * 23) < 400) {
        greenEnergizerPresent = false;
        mspacman.boostSpeed();
        main.playSound(main.ateEnergizerSound);
      }
    } else if (fruitTargetPresent) {
      fruitTarget.update(gc);
    } else if (++fruitTargetTimer == 10 * 91) {
      float v = main.random.nextFloat();
      if (v > fruitOdds) {
        createFruit();
      } else if (v > redPelletOdds) {
        createRedEnergizer();
      } else {
        createGreenEnergizer();
      }
      fruitTargetTimer = 0;
      main.playSound(main.fruitAppearedSound);
    }
  }

  public int distanceToMsPacMan(int x, int y) {
    return distance(mspacman.x, mspacman.y, x, y);
  }

  public int distance(int x1, int y1, int x2, int y2) {
    int x = x1 - x2;
    int y = y1 - y2;
    return x * x + y * y;
  }

  private void createRedEnergizer() {
    redEnergizerPresent = true;
    energizerTimer = 0;
  }

  private void createGreenEnergizer() {
    greenEnergizerPresent = true;
    energizerTimer = 0;
  }

  private void createFruit() {
    if (main.stageIndex == 7) {
      fruitTarget.fruitIndex = main.random.nextInt(7);
    } else {
      fruitTarget.fruitIndex = main.stageIndex;
    }
    fruitTargetPresent = true;
    int[] entry = fruitTargetEntries[
        main.random.nextInt(fruitTargetEntries.length)];
    if (entry[0] == 0) {
      fruitTarget.x = -32;
      fruitTarget.y = entry[1] << 4;
    } else if (entry[0] == 27) {
      fruitTarget.x = 448;
      fruitTarget.y = entry[1] << 4;
    } else if (entry[1] == 0) {
      fruitTarget.x = entry[0] << 4;
      fruitTarget.y = -32;
    } else if (entry[1] == 31) {
      fruitTarget.x = entry[0] << 4;
      fruitTarget.y = 496;
    }    
  }

  public void fruitTargetExited() {
    fruitTargetTimer = 0;
    fruitTargetPresent = false;
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    if (finishedWhite) {
      for(int i = 0; i < 31; i++) {
        for(int j = 0; j < 28; j++) {
          main.whiteTiles[tileMap[i][j]].draw(176 + (j << 4), 48 + (i << 4));
        }
      }
    } else {
      for(int i = 0; i < 31; i++) {
        for(int j = 0; j < 28; j++) {
          tiles[tileMap[i][j]].draw(176 + (j << 4), 48 + (i << 4));
        }
      }
    }
    if (energizersVisible) {
      for(int i = 0; i < 4; i++) {
        int[] energizerLocation = energizerLocations[i];
        tiles[47].draw(176 + (energizerLocation[0] << 4),
            48 + (energizerLocation[1] << 4));
      }
    }

    if (fruitTargetPresent) {
      if (!playerSpiraling) {
        fruitTarget.render(gc, g);
      }
    } else if (redEnergizerPresent) {
      if (energizersVisible) {
        main.redEnergizerSprite.draw(176 + 16 * 13 + 8, 48 + 16 * 23);
      }
    } else if (greenEnergizerPresent) {
      if (energizersVisible) {
        main.greenEnergizerSprite.draw(176 + 16 * 13 + 8, 48 + 16 * 23);
      }
    }
    if (playerSpiraling) {
      Image mspacmanSprite = main.mspacmanSprites[Main.RIGHT][1];
      main.draw(mspacmanSprite, 168 + mspacman.x, 40 + mspacman.y,
          spiralTimer * 9.8901098901098901098901098901099f,
          1f - spiralTimer * 0.0054945054945054945054945054945055f);
    } else {
      mspacman.render(gc, g);
      ghosts[Main.RED].render(gc, g);
      ghosts[Main.PINK].render(gc, g);
      ghosts[Main.CYAN].render(gc, g);
      ghosts[Main.ORANGE].render(gc, g);
    }

    g.setColor(Color.black);
    g.fillRect(112, 0, 576, 48);
    g.fillRect(112, 544, 576, 48);
    g.fillRect(112, 48, 64, 496);
    g.fillRect(624, 48, 64, 496);

    main.drawNumber(main.score, 10, 176, 16, Main.WHITE);
    main.drawString(stageMessage, 400, 16, Main.WHITE);

    Image mspacmanSprite = main.mspacmanSprites[Main.RIGHT][1];
    int livesCount = main.lives - 1;
    if (livesCount > 6) {
      livesCount = 6;
    }
    for(int i = livesCount; i >= 0; i--) {
      mspacmanSprite.draw(176 + (i << 5), 552);
    }
    int fruitCount = main.stageIndex + 1;
    if (fruitCount > 7) {
      fruitCount = 7;
    }
    for(int i = 0; i < fruitCount; i++) {
      main.fruitSprites[i].draw(592 - (i << 5), 552);
    }

    if (main.demoMode || gameOver) {
      main.drawString("GAME OVER", 20 * 16, Main.YELLOW);
    } else if (readyTimer > 0) {
      main.drawString("READY!", 20 * 16, Main.YELLOW);
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
