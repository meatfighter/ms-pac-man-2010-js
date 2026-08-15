/*
 * Ms. Pac-Man 2010
 * Copyright (C) 2010 meatfighter.com
 *
 * This file is part of Ms. Pac-Man 2010
 *
 * Ms. Pac-Man 2010 is free software; you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published
 * by the Free Software Foundation; either version 3 of the License, or
 * (at your option) any later version.
 *
 * Ms. Pac-Man 2010 is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

package mspacman;

import org.newdawn.slick.util.*;
import org.newdawn.slick.*;
import org.newdawn.slick.opengl.*;
import org.lwjgl.opengl.*;
import org.lwjgl.input.*;
import org.lwjgl.*;
import java.io.*;
import java.util.*;
import java.nio.*;

public class Main extends BasicGame {

  public static final int UP = 0;
  public static final int DOWN = 1;
  public static final int LEFT = 2;
  public static final int RIGHT = 3;

  public static final int RED = 0;
  public static final int PINK = 1;
  public static final int CYAN = 2;
  public static final int ORANGE = 3;
  public static final int WHITE = 4;
  public static final int YELLOW = 5;

  private static final long CURSOR_HIDE_DELAY_MS = 3000L;

  public static final IMode attractMode = new AttractMode();
  public static final IMode selectWorldMode = new SelectWorldMode();
  public static final IMode introMode = new IntroMode();
  public static final IMode playingMode = new PlayingMode();
  public static final IMode act1Mode = new Act1Mode();
  public static final IMode act2Mode = new Act2Mode();
  public static final IMode act3Mode = new Act3Mode();
  public static final IMode act4Mode = new Act4Mode();
  public static final IMode act5Mode = new Act5Mode();
  public static final IMode act6Mode = new Act6Mode();
  public static final IMode act7Mode = new Act7Mode();
  public static final IMode endingMode = new EndingMode();
  public static final IMode hallOfFameMode = new HallOfFameMode();
  public static final IMode loadingMode = new LoadingMode();
  public static final IMode enterInitialsMode = new EnterInitialsMode();

  public Color[] fades = new Color[23];
  public Random random = new Random();
  public int maxWidth = 0;
  public int maxHeight = 0;
  public int maxColorDepth = 0;
  public DisplayMode nativeDisplayMode;
  public MsPacManAppGameContainer appGameContainer;
  public AppletGameContainer2 appletGameContainer;
  public ScalableGame2 scalableGame;
  public long nextFrameTime;
  public IMode mode;
  public int worldIndex;
  public int stageIndex;
  public IInput input;
  public Music currentMusic;
  public Cursor nativeCursor;
  private Cursor hiddenCursor;
  private boolean mouseCursorHidden = false;
  private long lastMouseInputTime = System.currentTimeMillis();
  private int lastMouseX = Integer.MIN_VALUE;
  private int lastMouseY = Integer.MIN_VALUE;
  private int lastMouseButtonMask = 0;
  private boolean lastMouseInsideGameArea = false;
  public int score;
  public int lives;
  public boolean paused = false;
  public boolean fullscreenFallbackActive = false;
  public HighScore[][] highScores = new HighScore[4][5];
  private HighScoreService highScoreService = new HighScoreService();
  public float musicVolume = 1f;
  public float musicVolumeFadeStep = 1f / 91f;
  public boolean fadeMusic = false;
  public volatile boolean uploadComplete;
  public RobotInput[] robotInputs = new RobotInput[4];
  public int demoIndex;
  public boolean demoMode;

  public Image[][] symbols = new Image[6][256];
  public Image[][][] ghostSprites = new Image[4][4][2];
  public Image[][] mspacmanSprites = new Image[4][3];
  public Image[][] pacmanSprites = new Image[4][3];
  public Image[][] tiles = new Image[8][50];
  public Stage[][] stages = new Stage[4][8];
  public Image[] blueGhostSprites = new Image[4];
  public Image[] ghostPointsSprites = new Image[4];
  public Image[] eyeBallsSprites = new Image[4];
  public Image[] whiteTiles = new Image[50];
  public Image[] fruitSprites = new Image[7];
  public Image[] fruitPointsSprites = new Image[7];
  public Image redEnergizerSprite;
  public Image greenEnergizerSprite;
  public Image heartSprite;
  public Image clapperBottomSprite;
  public Image[] clapperTopSprites = new Image[3];
  public Image juniorSprite;
  public Image juniorRightSprite;
  public Image juniorBagSprite;
  public Image storkHeadSprite;
  public Image[] storkWingsSprites = new Image[2];

  public Music[] actMusic = new Music[3];
  public Music[] stageMusic = new Music[4];
  public Music trainingMusic;
  public Music introMusic;
  public Music levelSelectMusic;
  public Music highScoreMusic;
  public Music gameOverMusic;
  public Sound atePellotSound;
  public Sound ateEnergizerSound;
  public Sound ateGhostSound;
  public Sound ateFruitSound;
  public Sound fruitAppearedSound;
  public Sound blueGhostsSound;
  public Sound clappingSound;
  public Sound extraLifeSound;
  public Sound diedSound;
  public Sound pressedEnterSound;
  public Sound[][] speaking = new Sound[2][10];

  public Main() {
    super("MS PAC-MAN 2010");
  }

  public void init(GameContainer gc) throws SlickException {
    System.out.println(Thread.currentThread().getName());
    findNativeDisplayMode();
    initializeHighScores();
    initializeFadeColors();
    loadGraphics();
    loadSoundEffects();
    loadStages();
    loadDemos(gc);

    input = new HumanInput(gc);
    resetMouseCursorAutoHide();

    setMode(loadingMode, gc);     
  }

  public void update(GameContainer gc, int delta) throws SlickException {
    updateMouseCursorAutoHide();
    if (fadeMusic) {
      musicVolume -= musicVolumeFadeStep;
      if (musicVolume <= 0) {
        musicVolume = 0f;
        fadeMusic = false;
      }
      if (currentMusic != null) {
        currentMusic.setVolume(musicVolume);
      }
    }
    if (paused) {
      if (isGameplayPauseTogglePressed()) {
        paused = false;
        markMouseInput(System.currentTimeMillis());
        gc.setMusicOn(true);
      }
      resetNextFrameTime();
      return;
    } else if (isGameplayPauseTogglePressed()) {
      paused = true;
      markMouseInput(System.currentTimeMillis());
      stopAllSoundEffects();
      gc.setMusicOn(false);
    }
    int count = 0;
    while(nextFrameTime < Sys.getTime()) {
      fullScreenToggleCheck(gc);
      mode.update(gc);
      nextFrameTime += Sys.getTimerResolution() / 91;
      if (++count == 8) {
        resetNextFrameTime();
        break;
      }
    }
  }

  private void initializeFadeColors() {
    for(int i = 0; i < fades.length; i++) {
      fades[i] = new Color(0, 0, 0, (255 * i) / (fades.length - 1));
    }
  }

  private void fullScreenToggleCheck(GameContainer gc) throws SlickException {
    boolean isEscape = input.isFullscreenExitPressed();
    if (input.isFullscreenTogglePressed() || isEscape) {
      if (isFullscreenDisplayActive(gc)) {
        restoreWindowedDisplayMode(gc);
      } else if (!isEscape) {
        enterFullScreenDisplayMode(gc);
      }
      resetNextFrameTime();
    }
  }

  private boolean isGameplayPauseTogglePressed() {
    if (mode != Main.playingMode || demoMode) {
      return false;
    }
    return input.isPausePressed() || input.isGameplayStartPressed();
  }

  private boolean isFullscreenDisplayActive(GameContainer gc) {
    return gc.isFullscreen() || fullscreenFallbackActive;
  }

  private void restoreWindowedDisplayMode(GameContainer gc) {
    showMouseCursor();
    fullscreenFallbackActive = false;
    try {
      if (appGameContainer == null) {
        appletGameContainer.getContainer().setFullscreen(false);
      } else {
        appGameContainer.setDisplayMode(800, 600, false);
        scalableGame.containerSizeChanged(gc);
      }
    } catch(Throwable t) {
      Log.warn("Unable to restore the windowed display mode: "
          + describe(t));
    }
  }

  private void enterFullScreenDisplayMode(GameContainer gc) {
    markMouseInput(System.currentTimeMillis());
    if (appGameContainer == null) {
      try {
        appletGameContainer.getContainer().setDisplayMode(true);
      } catch(Throwable t) {
        showMouseCursor();
        Log.warn("Unable to enter applet fullscreen display mode: "
            + describe(t));
      }
      return;
    }

    try {
      long startTime = System.currentTimeMillis();
      appGameContainer.setNativeFullscreenDisplayMode(nativeDisplayMode);
      long elapsedTime = System.currentTimeMillis() - startTime;
      if (elapsedTime > 1000L) {
        Log.warn("Native fullscreen display mode took " + elapsedTime
            + " ms to apply.");
      }
      fullscreenFallbackActive = false;
      scalableGame.containerSizeChanged(gc);
    } catch(Throwable fullscreenError) {
      Log.warn("Unable to enter native fullscreen display mode; using a "
          + "desktop-size window: " + describe(fullscreenError));
      enterFullscreenWindowFallback(gc);
    }
  }

  private void enterFullscreenWindowFallback(GameContainer gc) {
    int width = maxWidth > 0 ? maxWidth : 800;
    int height = maxHeight > 0 ? maxHeight : 600;
    try {
      appGameContainer.setDisplayMode(800, 600, false);
      Display.setLocation(0, 0);
      appGameContainer.setDisplayMode(width, height, false);
      fullscreenFallbackActive = true;
      scalableGame.containerSizeChanged(gc);
    } catch(Throwable fallbackError) {
      fullscreenFallbackActive = false;
      showMouseCursor();
      Log.warn("Unable to use the desktop-size window fallback: "
          + describe(fallbackError));
    }
  }

  private String describe(Throwable t) {
    String message = t.getMessage();
    if (message == null || message.length() == 0) {
      return t.getClass().getName();
    }
    return message;
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    mode.render(gc, g);
    if (paused) {
      g.setColor(fades[11]);
      g.fillRect(0, 0, 800, 600);
      g.setColor(Color.black);
      g.fillRect(344, 284, 112, 32);
      drawString("PAUSED", 292, Main.YELLOW);
    }
  }

  public void advanceStage(GameContainer gc) throws SlickException {
    switch(++stageIndex) {
      case 1:
        setMode(Main.act1Mode, gc);
        break;
      case 2:
        setMode(Main.act2Mode, gc);
        break;
      case 3:
        setMode(Main.act3Mode, gc);
        break;
      case 4:
        setMode(Main.act4Mode, gc);
        break;
      case 5:
        setMode(Main.act5Mode, gc);
        break;
      case 6:
        setMode(Main.act6Mode, gc);
        break;
      case 7:
        setMode(Main.act7Mode, gc);
        break;
      case 8:
        setMode(Main.endingMode, gc);
        break;
    }
  }

  public void setMode(IMode mode, GameContainer gc) throws SlickException {
    this.mode = mode;
    mode.init(this, gc);
    mode.update(gc);
    input.clearKeyPressedRecord();
    resetNextFrameTime();
  }

  private void showMouseCursor() {
    if (!mouseCursorHidden) {
      return;
    }
    try {
      Mouse.setNativeCursor(nativeCursor);
      mouseCursorHidden = false;
    } catch (Exception e) {
			Log.error("Failed to load and apply cursor.", e);
		}
  }

  private void hideMouseCursor() {
    if (mouseCursorHidden) {
      return;
    }
    try {
      if (hiddenCursor == null) {
        ByteBuffer buffer = BufferUtils.createByteBuffer(32 * 32 * 4);
        hiddenCursor = CursorLoader.get().getCursor(buffer, 0, 0, 32, 32);
      }
      nativeCursor = Mouse.getNativeCursor();
			Mouse.setNativeCursor(hiddenCursor);
      mouseCursorHidden = true;
		} catch (Exception e) {
			Log.error("Failed to load and apply cursor.", e);
		}
  }

  private void resetMouseCursorAutoHide() {
    lastMouseInputTime = System.currentTimeMillis();
    lastMouseX = Integer.MIN_VALUE;
    lastMouseY = Integer.MIN_VALUE;
    lastMouseButtonMask = 0;
    lastMouseInsideGameArea = false;
    showMouseCursor();
  }

  private void updateMouseCursorAutoHide() {
    if (!Mouse.isCreated()) {
      return;
    }

    long now = System.currentTimeMillis();
    if (paused) {
      markMouseInput(now);
      return;
    }

    boolean mouseInsideGameArea = isMouseInsideGameArea();
    if (!mouseInsideGameArea) {
      lastMouseInsideGameArea = false;
      showMouseCursor();
      return;
    }

    if (!lastMouseInsideGameArea) {
      lastMouseInsideGameArea = true;
      markMouseInput(now);
      return;
    }

    if (hasMouseInputChanged()) {
      markMouseInput(now);
      return;
    }

    if (now - lastMouseInputTime >= CURSOR_HIDE_DELAY_MS) {
      hideMouseCursor();
    }
  }

  private void markMouseInput(long now) {
    lastMouseInputTime = now;
    showMouseCursor();
  }

  private boolean isMouseInsideGameArea() {
    try {
      return Mouse.isInsideWindow();
    } catch(Throwable t) {
      return true;
    }
  }

  private boolean hasMouseInputChanged() {
    int x = Mouse.getX();
    int y = Mouse.getY();
    int buttonMask = getMouseButtonMask();
    boolean changed = x != lastMouseX || y != lastMouseY
        || buttonMask != lastMouseButtonMask;
    lastMouseX = x;
    lastMouseY = y;
    lastMouseButtonMask = buttonMask;
    return changed;
  }

  private int getMouseButtonMask() {
    int mask = 0;
    int buttonCount = Math.min(Mouse.getButtonCount(), 31);
    for(int i = 0; i < buttonCount; i++) {
      if (Mouse.isButtonDown(i)) {
        mask |= 1 << i;
      }
    }
    return mask;
  }

  private void findNativeDisplayMode() throws SlickException {
    maxWidth = 800;
    maxHeight = 600;
    maxColorDepth = 0;
    nativeDisplayMode = null;

    try {
      DisplayMode displayMode = Display.getDesktopDisplayMode();
      if (isUsableDisplayMode(displayMode)) {
        setNativeDisplayMode(displayMode);
        return;
      }
    } catch(Throwable t) {
      Log.warn("Unable to read the desktop display mode: " + describe(t));
    }

    DisplayMode bestDisplayMode = null;
    try {
      for(DisplayMode displayMode : Display.getAvailableDisplayModes()) {
        if (isUsableDisplayMode(displayMode)
            && isBetterDisplayMode(displayMode, bestDisplayMode)) {
          bestDisplayMode = displayMode;
        }
      }
    } catch(Throwable t) {
      throw new SlickException("Error finding native monitor resolution.", t);
    }

    if (bestDisplayMode != null) {
      setNativeDisplayMode(bestDisplayMode);
    }
  }

  private boolean isUsableDisplayMode(DisplayMode displayMode) {
    return displayMode != null
        && displayMode.getWidth() > 0
        && displayMode.getHeight() > 0;
  }

  private boolean isBetterDisplayMode(
      DisplayMode displayMode, DisplayMode bestDisplayMode) {
    if (bestDisplayMode == null) {
      return true;
    }

    int area = displayMode.getWidth() * displayMode.getHeight();
    int bestArea = bestDisplayMode.getWidth() * bestDisplayMode.getHeight();
    return area > bestArea
        || (area == bestArea
        && displayMode.getBitsPerPixel() > bestDisplayMode.getBitsPerPixel());
  }

  private void setNativeDisplayMode(DisplayMode displayMode) {
    nativeDisplayMode = displayMode;
    maxWidth = displayMode.getWidth();
    maxHeight = displayMode.getHeight();
    maxColorDepth = displayMode.getBitsPerPixel();
  }

  private void loadStages() throws SlickException {
    for(int a = 0; a < 4; a++) {
      for(int b = 0; b < 8; b++) {
        loadStage(a, b);
      }
    }
  }

  private void loadDemos(GameContainer gc) {
    for(int i = 0; i < 4; i++) {
      loadDemo(gc, i);
    }
  }

  private void loadDemo(GameContainer gc, int a) {
    final int[] lengths = { 4390, 4381, 7539, 3676 };
    try {
      ClassLoader classLoader = Main.class.getClassLoader();
      String fileName = "demos/demo_" + a + "_" + a + ".dat";
      byte[] data = new byte[lengths[a]];
      DataInputStream dis = new DataInputStream(
          new BufferedInputStream(classLoader.getResourceAsStream(fileName)));
      dis.readFully(data);
      robotInputs[a] = new RobotInput(data, gc);
    } catch(Throwable t) {
    }
  }

  private void loadStage(int a, int b) {
    try {
      Stage stage = stages[a][b] = new Stage();
      ClassLoader classLoader = Main.class.getClassLoader();
      String fileName = "stages/stage_" + a + "_" + b + ".dat";
      DataInputStream dis = new DataInputStream(
          new BufferedInputStream(classLoader.getResourceAsStream(fileName)));
      stage.pelletCount = dis.readInt();
      stage.regionCount = dis.readInt();
      for(int i = 0; i < 31; i++) {
        for(int j = 0; j < 28; j++) {
          stage.tileMap[i][j] = dis.read();
        }
      }
      for(int i = 0; i < 31; i++) {
        for(int j = 0; j < 28; j++) {
          stage.regionMap[i][j] = dis.read();
        }
      }
      for(int i = 0; i < 31; i++) {
        for(int j = 0; j < 28; j++) {
          stage.homeTree[i][j] = dis.read();
        }
      }

      int leftExitMapCount = dis.readInt();
      stage.leftExitMaps = new int[leftExitMapCount][31][28];
      for(int i = 0; i < leftExitMapCount; i++) {
        int size = dis.readInt();
        for(int j = 0; j < size; j++) {
          int x = dis.readInt();
          int y = dis.readInt();
          int direction = dis.readInt();
          stage.leftExitMaps[i][y][x] = direction;
        }
      }

      int rightExitMapCount = dis.readInt();
      stage.rightExitMaps = new int[rightExitMapCount][31][28];
      for(int i = 0; i < rightExitMapCount; i++) {
        int size = dis.readInt();
        for(int j = 0; j < size; j++) {
          int x = dis.readInt();
          int y = dis.readInt();
          int direction = dis.readInt();
          stage.rightExitMaps[i][y][x] = direction;
        }
      }

      dis.close();
    } catch(Throwable t) {
    }
  }

  public void drawNumber(int value, int digits, int x, int y, int color) {
    Image[] s = symbols[color];
    if (value < 0) {
      value = 0;
    }
    x += (digits - 1) << 4;
    if (value == 0) {
      s['0'].draw(x, y);
      return;
    }
    for(int i = 0; i < digits && value != 0; i++, x -= 16, value /= 10) {
      s['0' + (value % 10)].draw(x, y);
    }
  }

  public void drawString(String s, int y, int color) {
    drawString(s, 400 - (s.length() << 3), y, color);
  }

  public void drawString(
      String string, float x, float y, int color, float scale) {
    GL11.glPushMatrix();
    GL11.glTranslatef(x, y, 0);
    GL11.glScalef(scale, scale, 1);            
    Image[] s = symbols[color];
    for(int i = 0; i < string.length(); i++) {
      Image image = s[string.charAt(i)];
      if (image != null) {
        image.draw(i << 4, 0);
      }
    }
    GL11.glPopMatrix();  
  }

  public void drawString(String string, int x, int y, int color) {
    if (y < -16 || y > 600) {
      return;
    }
    Image[] s = symbols[color];
    for(int i = 0; i < string.length(); i++, x += 16) {
      Image image = s[string.charAt(i)];
      if (image != null) {
        image.draw(x, y);
      }
    }
  }

  public void draw(Image image, float x, float y, float alpha) {
    image.setAlpha(alpha);
    image.draw(x, y);
    image.setAlpha(1f);
  }

  public void playSound(Sound sound) {
    sound.play();
  }

  public void stopSound(Sound sound) {
    blueGhostsSound.stop();
  }

  public void stopAllSoundEffects() {
    atePellotSound.stop();
    ateEnergizerSound.stop();
    ateGhostSound.stop();
    ateFruitSound.stop();
    fruitAppearedSound.stop();
    blueGhostsSound.stop();
    clappingSound.stop();
    extraLifeSound.stop();
    diedSound.stop();
    pressedEnterSound.stop();
  }

  public void stopAllSounds() {
    stopMusic();
    stopAllSoundEffects();
  }
  
  public void draw(Image image, float x, float y, float angle, float scale) {
    GL11.glPushMatrix();    
    GL11.glTranslatef(
        x + image.getWidth() * .5f, y + image.getHeight() * .5f, 0);
    GL11.glRotatef(angle, 0, 0, 1);
    GL11.glScalef(scale, scale, 1);
    image.draw(-image.getWidth() * .5f, -image.getHeight() * .5f);
    GL11.glPopMatrix();
  }

  public void drawScaled(Image image, float x, float y, float scale) {
    GL11.glPushMatrix();
    GL11.glTranslatef(
        x + image.getWidth() * .5f, y + image.getHeight() * .5f, 0);
    GL11.glScalef(scale, scale, 1);
    image.draw(-image.getWidth() * .5f, -image.getHeight() * .5f);
    GL11.glPopMatrix();
  }

  public void fadeMusic() {
    if (currentMusic != null) {
      fadeMusic = true;
      musicVolume = 1f;
    }
  }

  public void stopMusic() {
    fadeMusic = false;
    musicVolume = 1f;
    if (currentMusic != null) {
      currentMusic.stop();
    }
  }

  public void playMusic(Music music) {
    stopMusic();
    fadeMusic = false;
    musicVolume = 1f;
    currentMusic = music;
    music.setVolume(1f);
    if (!demoMode) {
      music.play();
    }
    music.setVolume(1f);
  }

  public void loopMusic(Music music) {
    stopMusic();
    fadeMusic = false;
    musicVolume = 1f;
    currentMusic = music;
    music.setVolume(1f);
    if (!demoMode) {
      music.loop();
    }
    music.setVolume(1f);
  }

  private void loadSoundEffects() throws SlickException {
    fruitAppearedSound = new Sound("soundfx/fruit_appeared.ogg");
    ateFruitSound = new Sound("soundfx/ate_fruit.ogg");
    atePellotSound = new Sound("soundfx/ate_pellot.ogg");
    ateEnergizerSound = new Sound("soundfx/ate_energizer.ogg");
    blueGhostsSound = new Sound("soundfx/blue_ghosts.ogg");
    ateGhostSound = new Sound("soundfx/ate_ghost.ogg");
    clappingSound = new Sound("soundfx/clapping.ogg");
    extraLifeSound = new Sound("soundfx/extra_life.ogg");
    diedSound = new Sound("soundfx/died.ogg");
    pressedEnterSound = new Sound("soundfx/pressed_enter.ogg");

    for(int i = 0; i < 2; i++) {
      for(int j = 0; j < 10; j++) {
        speaking[i][j] = new Sound(
            "soundfx/speaking_" + (i + 1) + "_" + j + ".ogg");
      }
    }
  }

  private void loadGraphics() throws SlickException {

    PackedSpriteSheet pack1 = new PackedSpriteSheet("images/pack_1.def",
        Image.FILTER_NEAREST);
    PackedSpriteSheet pack2 = new PackedSpriteSheet("images/pack_2.def",
        Image.FILTER_NEAREST);

    for(int i = 0; i < 8; i++) {
      for(int j = 0; j < 47; j++) {
        tiles[i][j] = pack2.getSprite("stage_" + i + "_" + j);
      }
      tiles[i][47] = pack2.getSprite("empty");
      if (((i & 1) == 0 || i == 5 || i == 3) && i != 4) {
        tiles[i][48] = pack2.getSprite("white_pellot");
        tiles[i][49] = pack2.getSprite("white_energizer");
      } else {
        tiles[i][48] = pack2.getSprite("yellow_pellot");
        tiles[i][49] = pack2.getSprite("yellow_energizer");
      }
    }

    for(int j = 0; j < 46; j++) {
      whiteTiles[j] = pack2.getSprite("white_" + j);
    }
    whiteTiles[46] = pack2.getSprite("stage_7_46");
    whiteTiles[47] = pack2.getSprite("empty");
    whiteTiles[48] = pack2.getSprite("white_pellot");
    whiteTiles[49] = pack2.getSprite("white_energizer");   

    mspacmanSprites[UP][0] = pack1.getSprite("ms_pac_man_up_1");
    mspacmanSprites[UP][1] = pack1.getSprite("ms_pac_man_up_2");
    mspacmanSprites[UP][2] = pack1.getSprite("ms_pac_man_up_3");
    mspacmanSprites[DOWN][0] = pack1.getSprite("ms_pac_man_down_1");
    mspacmanSprites[DOWN][1] = pack1.getSprite("ms_pac_man_down_2");
    mspacmanSprites[DOWN][2] = pack1.getSprite("ms_pac_man_down_3");
    mspacmanSprites[LEFT][0] = pack1.getSprite("ms_pac_man_left_1");
    mspacmanSprites[LEFT][1] = pack1.getSprite("ms_pac_man_left_2");
    mspacmanSprites[LEFT][2] = pack1.getSprite("ms_pac_man_left_3");
    mspacmanSprites[RIGHT][0] = pack1.getSprite("ms_pac_man_right_1");
    mspacmanSprites[RIGHT][1] = pack1.getSprite("ms_pac_man_right_2");
    mspacmanSprites[RIGHT][2] = pack1.getSprite("ms_pac_man_right_3");

    pacmanSprites[UP][0] = pack1.getSprite("pac_man_up_1");
    pacmanSprites[UP][1] = pack1.getSprite("pac_man_up_2");
    pacmanSprites[UP][2] = pack1.getSprite("pac_man_closed");
    pacmanSprites[DOWN][0] = pack1.getSprite("pac_man_down_1");
    pacmanSprites[DOWN][1] = pack1.getSprite("pac_man_down_2");
    pacmanSprites[DOWN][2] = pack1.getSprite("pac_man_closed");
    pacmanSprites[LEFT][0] = pack1.getSprite("pac_man_left_1");
    pacmanSprites[LEFT][1] = pack1.getSprite("pac_man_left_2");
    pacmanSprites[LEFT][2] = pack1.getSprite("pac_man_closed");
    pacmanSprites[RIGHT][0] = pack1.getSprite("pac_man_right_1");
    pacmanSprites[RIGHT][1] = pack1.getSprite("pac_man_right_2");
    pacmanSprites[RIGHT][2] = pack1.getSprite("pac_man_closed");

    ghostSprites[RED][UP][0] = pack1.getSprite("red_ghost_up_1");
    ghostSprites[RED][UP][1] = pack1.getSprite("red_ghost_up_2");
    ghostSprites[RED][DOWN][0] = pack1.getSprite("red_ghost_down_1");
    ghostSprites[RED][DOWN][1] = pack1.getSprite("red_ghost_down_2");
    ghostSprites[RED][LEFT][0] = pack1.getSprite("red_ghost_left_1");
    ghostSprites[RED][LEFT][1] = pack1.getSprite("red_ghost_left_2");
    ghostSprites[RED][RIGHT][0] = pack1.getSprite("red_ghost_right_1");
    ghostSprites[RED][RIGHT][1] = pack1.getSprite("red_ghost_right_2");

    ghostSprites[PINK][UP][0] = pack1.getSprite("pink_ghost_up_1");
    ghostSprites[PINK][UP][1] = pack1.getSprite("pink_ghost_up_2");
    ghostSprites[PINK][DOWN][0] = pack1.getSprite("pink_ghost_down_1");
    ghostSprites[PINK][DOWN][1] = pack1.getSprite("pink_ghost_down_2");
    ghostSprites[PINK][LEFT][0] = pack1.getSprite("pink_ghost_left_1");
    ghostSprites[PINK][LEFT][1] = pack1.getSprite("pink_ghost_left_2");
    ghostSprites[PINK][RIGHT][0] = pack1.getSprite("pink_ghost_right_1");
    ghostSprites[PINK][RIGHT][1] = pack1.getSprite("pink_ghost_right_2");
    
    ghostSprites[CYAN][UP][0] = pack1.getSprite("cyan_ghost_up_1");
    ghostSprites[CYAN][UP][1] = pack1.getSprite("cyan_ghost_up_2");
    ghostSprites[CYAN][DOWN][0] = pack1.getSprite("cyan_ghost_down_1");
    ghostSprites[CYAN][DOWN][1] = pack1.getSprite("cyan_ghost_down_2");
    ghostSprites[CYAN][LEFT][0] = pack1.getSprite("cyan_ghost_left_1");
    ghostSprites[CYAN][LEFT][1] = pack1.getSprite("cyan_ghost_left_2");
    ghostSprites[CYAN][RIGHT][0] = pack1.getSprite("cyan_ghost_right_1");
    ghostSprites[CYAN][RIGHT][1] = pack1.getSprite("cyan_ghost_right_2");

    ghostSprites[ORANGE][UP][0] = pack1.getSprite("orange_ghost_up_1");
    ghostSprites[ORANGE][UP][1] = pack1.getSprite("orange_ghost_up_2");
    ghostSprites[ORANGE][DOWN][0] = pack1.getSprite("orange_ghost_down_1");
    ghostSprites[ORANGE][DOWN][1] = pack1.getSprite("orange_ghost_down_2");
    ghostSprites[ORANGE][LEFT][0] = pack1.getSprite("orange_ghost_left_1");
    ghostSprites[ORANGE][LEFT][1] = pack1.getSprite("orange_ghost_left_2");
    ghostSprites[ORANGE][RIGHT][0] = pack1.getSprite("orange_ghost_right_1");
    ghostSprites[ORANGE][RIGHT][1] = pack1.getSprite("orange_ghost_right_2");

    blueGhostSprites[0] = pack1.getSprite("blue_ghost_1");
    blueGhostSprites[1] = pack1.getSprite("blue_ghost_2");
    blueGhostSprites[2] = pack1.getSprite("white_ghost_1");
    blueGhostSprites[3] = pack1.getSprite("white_ghost_1");

    ghostPointsSprites[0] = pack1.getSprite("points_200");
    ghostPointsSprites[1] = pack1.getSprite("points_400");
    ghostPointsSprites[2] = pack1.getSprite("points_800");
    ghostPointsSprites[3] = pack1.getSprite("points_1600");

    eyeBallsSprites[UP] = pack1.getSprite("eyes_up_1");
    eyeBallsSprites[DOWN] = pack1.getSprite("eyes_down_1");
    eyeBallsSprites[LEFT] = pack1.getSprite("eyes_left_1");
    eyeBallsSprites[RIGHT] = pack1.getSprite("eyes_right_1");

    fruitSprites[0] = pack1.getSprite("cherries");
    fruitSprites[1] = pack1.getSprite("strawberry");
    fruitSprites[2] = pack1.getSprite("orange");
    fruitSprites[3] = pack1.getSprite("pretzel");
    fruitSprites[4] = pack1.getSprite("apple");
    fruitSprites[5] = pack1.getSprite("pear");
    fruitSprites[6] = pack1.getSprite("banana");

    fruitPointsSprites[0] = pack1.getSprite("diagonal_100");
    fruitPointsSprites[1] = pack1.getSprite("diagonal_200");
    fruitPointsSprites[2] = pack1.getSprite("diagonal_500");
    fruitPointsSprites[3] = pack1.getSprite("diagonal_700");
    fruitPointsSprites[4] = pack1.getSprite("diagonal_1000");
    fruitPointsSprites[5] = pack1.getSprite("diagonal_2000");
    fruitPointsSprites[6] = pack1.getSprite("diagonal_5000");

    redEnergizerSprite = pack2.getSprite("red_energizer");
    greenEnergizerSprite = pack2.getSprite("green_energizer");
    heartSprite = pack1.getSprite("heart");
    clapperBottomSprite = pack1.getSprite("clapper_bottom");
    clapperTopSprites[0] = pack1.getSprite("clapper_top_1");
    clapperTopSprites[1] = pack1.getSprite("clapper_top_2");
    clapperTopSprites[2] = pack1.getSprite("clapper_top_3");

    juniorSprite = pack1.getSprite("junior");
    juniorRightSprite = juniorSprite.getFlippedCopy(true, false);
    juniorBagSprite = pack1.getSprite("junior_bag");
    storkHeadSprite = pack1.getSprite("stork_head");
    storkWingsSprites[0] = pack1.getSprite("stork_wings_1");
    storkWingsSprites[1] = pack1.getSprite("stork_wings_2");

    loadSymbols(RED, "red", pack2);
    loadSymbols(PINK, "pink", pack2);
    loadSymbols(CYAN, "cyan", pack2);
    loadSymbols(ORANGE, "orange", pack2);
    loadSymbols(WHITE, "white", pack2);
    loadSymbols(YELLOW, "yellow", pack2);
  }

  private void loadSymbols(int color, String prefix, PackedSpriteSheet pack2) {
    Image[] glyphs = symbols[color];
    for(char c = 'a'; c <= 'z'; c++) {      
      glyphs['A' + (c - 'a')] = glyphs[c]
          = pack2.getSprite(prefix + "_symbol_" + c);
    }
    for(char c = '0'; c <= '9'; c++) {
      glyphs[c] = pack2.getSprite(prefix + "_symbol_" + c);
    }
    glyphs[':'] = pack2.getSprite(prefix + "_symbol_colon");
    glyphs[','] = pack2.getSprite(prefix + "_symbol_comma");
    glyphs['@'] = pack2.getSprite(prefix + "_symbol_copyright");
    glyphs['!'] = pack2.getSprite(prefix + "_symbol_exclamation");
    glyphs['/'] = pack2.getSprite(prefix + "_symbol_forward_slash");
    glyphs['-'] = pack2.getSprite(prefix + "_symbol_hyphen");
    glyphs['"'] = pack2.getSprite(prefix + "_symbol_left_quote");
    glyphs['.'] = pack2.getSprite(prefix + "_symbol_period");
    glyphs['\''] = pack2.getSprite(prefix + "_symbol_right_quote");
  }

  public void resetNextFrameTime() {
    nextFrameTime = Sys.getTime();
  }

  public boolean intersects(
      int ax1, int ay1, int ax2, int ay2,
      int bx1, int by1, int bx2, int by2) {
    return ax2 >= bx1 && ax1 <= bx2 && ay2 >= by1 && ay1 <= by2;
  }

  private void initializeHighScores() {
    for(int i = 0; i < 4; i++) {
      for(int j = 0; j < 5; j++) {
        highScores[i][j] = new HighScore();
      }
    }
  }

  public boolean isHighScore() {
    return score > 0 && highScores[worldIndex][4].score <= score;
  }

  public void downloadScores() {
    highScoreService.downloadScores(highScores);
  }

  public void accessScoresDatabaseAsync(final boolean update,
      final int world, final int score, final String initials) {

    uploadComplete = false;
    final String normalizedInitials = normalizeHighScoreInitials(initials);
    accessScoresDatabase(update, world, score, normalizedInitials);

    Thread thread = new Thread(new Runnable() {
      public void run() {
        try {
          if (update) {
            highScoreService.submitScore(
                highScores, world, score, normalizedInitials);
          }
        } finally {
          uploadComplete = true;
        }
      }
    }, "mspacman-high-score");
    thread.setDaemon(true);
    thread.start();
  }

  public void accessScoresDatabase(
      boolean update, int world, int score, String initials) {

    if (!update || world < 0 || world >= highScores.length) {
      return;
    }

    HighScore highScore = new HighScore();
    highScore.score = score;
    highScore.initials = normalizeHighScoreInitials(initials);

    HighScore[] rows = highScores[world];
    for(int i = 0; i < rows.length; i++) {
      if (score > rows[i].score) {
        for(int j = rows.length - 1; j > i; j--) {
          rows[j] = rows[j - 1];
        }
        rows[i] = highScore;
        break;
      }
    }
  }

  private String normalizeHighScoreInitials(String initials) {
    String value = initials;
    while(value.length() < 3) {
      value += " ";
    }
    if (value.length() > 3) {
      value = value.substring(0, 3);
    }
    return value;
  }

  @Override
  public boolean closeRequested() {
    showMouseCursor();
    stopAllSounds();
    return super.closeRequested();
  }

  public static void main(String[] args) throws SlickException {
    java.awt.Toolkit.getDefaultToolkit();
    HumanInput.installJInputPollFailureFilter();
    Input.disableControllers();

    Main main = new Main();
    main.scalableGame = new ScalableGame2(main, 800, 600, true);
    main.appGameContainer = new MsPacManAppGameContainer(main.scalableGame);
    main.appGameContainer.setDisplayMode(800, 600, false);
    main.appGameContainer.setAlwaysRender(true);
    main.appGameContainer.setVSync(true);
    main.appGameContainer.setSmoothDeltas(false);
    main.appGameContainer.setShowFPS(false);
    main.appGameContainer.setSoundOn(false);
    main.appGameContainer.setClearEachFrame(true);
    main.configureWindowIcon();
    main.appGameContainer.start();
  }

  private void configureWindowIcon() {
    try {
      appGameContainer.setIcon("favicon.png");
    } catch(Throwable t) {
      Log.warn("Unable to set the desktop window icon: " + describe(t));
    }
  }
}
