package mspacman;

import org.newdawn.slick.*;

public class CyanGhost extends Ghost {

  public CyanGhost(PlayingMode playingMode) {
    super(playingMode, Main.CYAN);
  }

  @Override
  public void reset() {
    super.reset();
    x = 11 * 16 + 8;
    y = 14 * 16;
    direction = Main.UP;
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
          targetY -= 2 * 16;
          break;
        case Main.DOWN:
          targetY += 2 * 16;
          break;
        case Main.LEFT:
          targetX -= 2 * 16;
          break;
        case Main.RIGHT:
          targetX += 2 * 16;
          break;
      }
      Ghost ghost = playingMode.ghosts[0];
      targetX += targetX - ghost.x;
      targetY += targetY - ghost.y;
    } else {
      targetX = 16 * 28;
      targetY = 16 * 31;
    }
  }
}
