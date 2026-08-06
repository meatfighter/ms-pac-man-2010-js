package mspacman;

import org.newdawn.slick.*;

public class RedGhost extends Ghost {

  public RedGhost(PlayingMode playingMode) {
    super(playingMode, Main.RED);
  }

  @Override
  public void reset() {
    super.reset();
    x = 13 * 16 + 8;
    y = 11 * 16;
    direction = Main.LEFT;
    inHome = false;
  }

  @Override
  public void updateGhost(GameContainer gc) throws SlickException {
    if (playingMode.chaseMode) {
      targetX = playingMode.mspacman.x;
      targetY = playingMode.mspacman.y;
    } else {
      targetX = 16 * 28;
      targetY = 16 * -1;
    }
  }
}
