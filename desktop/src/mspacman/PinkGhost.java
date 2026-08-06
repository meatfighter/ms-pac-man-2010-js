package mspacman;

import org.newdawn.slick.*;

public class PinkGhost extends Ghost {

  public PinkGhost(PlayingMode playingMode) {
    super(playingMode, Main.PINK);
  }

  @Override
  public void reset() {
    super.reset();
    x = 13 * 16 + 8;
    y = 14 * 16;
    direction = Main.DOWN;
    inHome = true;
  }

  @Override
  public void updateGhost(GameContainer gc) throws SlickException {
    if (playingMode.chaseMode) {
      targetX = playingMode.mspacman.x;
      targetY = playingMode.mspacman.y;
      MsPacMan mspacman = playingMode.mspacman;
      switch(mspacman.direction) {
        case Main.UP:
          targetY -= 4 * 16;
          break;
        case Main.DOWN:
          targetY += 4 * 16;
          break;
        case Main.LEFT:
          targetX -= 4 * 16;
          break;
        case Main.RIGHT:
          targetX += 4 * 16;
          break;
      }
    } else {
      targetX = 16 * -1;
      targetY = 16 * -1;
    }
  }
}
