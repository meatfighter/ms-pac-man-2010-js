package mspacman;

import org.newdawn.slick.*;

public class OrangeGhost extends Ghost {

  public OrangeGhost(PlayingMode playingMode) {
    super(playingMode, Main.ORANGE);
  }

  @Override
  public void reset() {
    super.reset();
    x = 15 * 16 + 8;
    y = 14 * 16;
    direction = Main.UP;
    inHome = true;
  }

  @Override
  public void updateGhost(GameContainer gc) throws SlickException {
    if (playingMode.chaseMode) {
      targetX = playingMode.mspacman.x;
      targetY = playingMode.mspacman.y;
      if (getDist(x, y) < 16384) {
        targetX = 16 * -1;
        targetY = 16 * 31;
      }
    } else {
      targetX = 16 * -1;
      targetY = 16 * 31;
    }
  }
}
