package mspacman;

import org.newdawn.slick.*;

public abstract class Thing {

  public int x;
  public int y;
  public float speed;
  public float speedRemainder;
  public int direction;
  public PlayingMode playingMode;
  public Main main;

  public Thing(PlayingMode playingMode) {
    this.playingMode = playingMode;
    this.main = playingMode.main;
  }

  public boolean canMoveLeft() {
    return (y & 15) == 0 && getType(x - 1, y) != PlayingMode.TYPE_WALL;
  }

  public boolean canMoveRight() {
    return (y & 15) == 0 && getType(x + 16, y) != PlayingMode.TYPE_WALL;
  }

  public boolean canMoveUp() {
    return (x & 15) == 0 && getType(x, y - 1) != PlayingMode.TYPE_WALL;
  }

  public boolean canMoveDown() {
    return (x & 15) == 0 && getType(x, y + 16) != PlayingMode.TYPE_WALL;
  }

  public int getMsPacManDistance() {
    int dx = x - playingMode.mspacman.x;
    int dy = y - playingMode.mspacman.y;
    return dx * dx + dy * dy;
  }

  public int getHomeDirection(int x, int y) {
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
    return playingMode.homeTree[ty][tx];
  }

  public int getTile(int x, int y) {
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
    return playingMode.tileMap[ty][tx];
  }

  public void setTile(int x, int y, int tile) {
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
    playingMode.tileMap[ty][tx] = tile;
  }

  public int getType(int x, int y) {
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
    return playingMode.typeMap[ty][tx];
  }

  public void setType(int x, int y, int type) {
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
    playingMode.typeMap[ty][tx] = type;
  }

  public void draw(Image image, int x, int y) {
    image.draw(168 + x, 40 + y);
  }

  public void draw(Image image) {
    image.draw(168 + x, 40 + y);
  }

  public abstract void update(GameContainer gc) throws SlickException;

  public abstract void render(GameContainer gc, Graphics g)
      throws SlickException;
}
