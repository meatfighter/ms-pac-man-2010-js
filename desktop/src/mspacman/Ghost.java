package mspacman;

import org.newdawn.slick.*;

public abstract class Ghost extends Thing {

  public static final int FLUTTER_SPEED = 15;

  public static final int[] REVERSE_DIRECTION = new int[4];

  public boolean blue;
  public boolean eyeBalls;
  public int ghostIndex;
  public int spriteIndex;
  public int spriteIndexIncrementor;
  public Image[][] sprites;
  public int targetX;
  public int targetY;

  public boolean inHome;
  public boolean exitingHome;
  public boolean enteringHome;

  static {
    REVERSE_DIRECTION[Main.UP] = Main.DOWN;
    REVERSE_DIRECTION[Main.DOWN] = Main.UP;
    REVERSE_DIRECTION[Main.LEFT] = Main.RIGHT;
    REVERSE_DIRECTION[Main.RIGHT] = Main.LEFT;
  }

  public Ghost(PlayingMode playingMode, int ghostIndex) {
    super(playingMode);
    this.ghostIndex = ghostIndex;
    sprites = playingMode.main.ghostSprites[ghostIndex];
  }

  public int getDist(int x, int y) {
    int dx = x - targetX;
    int dy = y - targetY;
    return dx * dx + dy * dy;
  }

  @Override
  public void update(GameContainer gc) throws SlickException {

    if (playingMode.showGhostPoints
        && (!eyeBalls || playingMode.eatenGhost == this)) {
      return;
    }

    float speed = this.speed;

    if (inHome || blue || x > 424 || x < 8 || y > 472 || y < 8) {
      speed = 0.5f;
    } else if (ghostIndex == Main.RED) {
      speed *= 1.0f
          + 0.2f * (1.0f - playingMode.pelletsRemaining
              * playingMode.pelletCountFraction);
      float maxSpeed = 1.01f * playingMode.mspacman.speed;
      if (speed > maxSpeed) {
        speed = maxSpeed;
      }
    }

    if (eyeBalls) {
      if (enteringHome) {
        speed = 0.5f;
      } else {
        speed = 1.5f;
      }
    }

    if (++spriteIndexIncrementor == FLUTTER_SPEED) {
      spriteIndexIncrementor = 0;
      if (++spriteIndex == 2) {
        spriteIndex = 0;
      }
    }

    speedRemainder += speed;

    while(speedRemainder >= 1f) {

      speedRemainder--;

      playingMode.decrementRegionCount(this);

      updateGhost(gc);

      if (inHome) {
        moveInHome();
      } else if (eyeBalls) {
        if (enteringHome) {
          enterHome();
        } else {
          moveEyeBalls();
        }
      } else if (blue) {
        moveRandomly();
      } else {
        chase();
      }

      if (x >= 448) {
        x -= 448;
      } else if (x <= -32) {
        x += 448;
      }
      if (y >= 496) {
        y -= 496;
      } else if (y <= -32) {
        y += 496;
      }

      playingMode.incrementRegionCount(this);
      if (playingMode.playerKilled) {
        // Wrapping and region bookkeeping for the killing step are now complete.
        speedRemainder %= 1f;
        return;
      }
    }
  }

  public void reverseDirection() {
    direction = REVERSE_DIRECTION[direction];
  }

  public void enterHome() {
    if (y < 14 * 16) {
      y++;
      direction = Main.DOWN;
    } else if (ghostIndex == Main.CYAN && x > 11 * 16 + 8) {
      x--;
      direction = Main.LEFT;
    } else if (ghostIndex == Main.ORANGE && x < 15 * 16 + 8) {
      x++;
      direction = Main.RIGHT;
    } else {
      eyeBalls = false;
      inHome = true;
      blue = false;
      exitingHome = true;
      enteringHome = false;
    }
  }

  public void moveEyeBalls() {
    
    if ((x & 15) == 0 && (y & 15) == 0) {
      switch(getHomeDirection(x, y)) {
        case 5:
        case 1:
          direction = Main.RIGHT;
          break;
        case 2:
          direction = Main.LEFT;
          break;
        case 3:
          direction = Main.DOWN;
          break;
        case 4:
          direction = Main.UP;
          break;
      }
    }

    switch(direction) {
      case Main.UP:
        y--;
        break;
      case Main.DOWN:
        y++;
        break;
      case Main.LEFT:
        x--;
        break;
      case Main.RIGHT:
        x++;
        break;
    }

    if (x == 13 * 16 + 8 && y == 11 * 16) {
      enteringHome = true;
    }
  }

  public void moveInHome() {

    if (exitingHome) {
      if (x != 13 * 16 + 8) {
        if (y < 14 * 16) {
          y++;
          direction = Main.UP;
        } else if (y > 14 * 16) {
          y--;
          direction = Main.DOWN;
        } else if (x < 13 * 16 + 8) {
          x++;
          direction = Main.RIGHT;
        } else if (x > 13 * 16 + 8) {
          x--;
          direction = Main.LEFT;
        }
      } else if (y > 11 * 16) {
        y--;
        direction = Main.UP;
      } else {
        inHome = false;
        speed = 1f;
      }
    } else {
      switch(direction) {
        case Main.UP:
          if (getType(x, y - 9) == PlayingMode.TYPE_WALL) {
            direction = Main.DOWN;
          }
          break;
        case Main.DOWN:
          if (getType(x, y + 24) == PlayingMode.TYPE_WALL) {
            direction = Main.UP;
          }
          break;
      }

      switch(direction) {
        case Main.UP:
          y--;
          break;
        case Main.DOWN:
          y++;
          break;
      }
    }
  }

  public void moveRandomly() {

    if (getMsPacManDistance() < 400) {
      playingMode.ghostEaten(this);
      return;
    }

    int reverseDirection = REVERSE_DIRECTION[direction];

    int minDist = Integer.MAX_VALUE;
    int minDirection = direction;

    for(int i = 0; i < 4; i++) {
      if (i != reverseDirection) {
        switch(i) {
          case Main.UP:
            if (canMoveUp()) {
              int dist = main.random.nextInt(7919);
              if (playingMode.getRegionCount(x, y - 1) != 0) {
                dist += 10000000;
              }
              if (dist < minDist) {
                minDist = dist;
                minDirection = Main.UP;
              }
            }
            break;
          case Main.DOWN:
            if (canMoveDown()) {
              int dist = main.random.nextInt(7919);
              if (playingMode.getRegionCount(x, y + 16) != 0) {
                dist += 10000000;
              }
              if (dist < minDist) {
                minDist = dist;
                minDirection = Main.DOWN;
              }
            }
            break;
          case Main.LEFT:
            if (canMoveLeft()) {
              int dist = main.random.nextInt(7919);
              if (playingMode.getRegionCount(x - 1, y) != 0) {
                dist += 10000000;
              }
              if (dist < minDist) {
                minDist = dist;
                minDirection = Main.LEFT;
              }
            }
            break;
          case Main.RIGHT:
            if (canMoveRight()) {
              int dist = main.random.nextInt(7919);
              if (playingMode.getRegionCount(x + 16, y) != 0) {
                dist += 10000000;
              }
              if (dist < minDist) {
                minDist = dist;
                minDirection = Main.RIGHT;
              }
            }
            break;
        }
      }
    }

    direction = minDirection;

    switch(direction) {
      case Main.UP:
        y--;
        break;
      case Main.DOWN:
        y++;
        break;
      case Main.LEFT:
        x--;
        break;
      case Main.RIGHT:
        x++;
        break;
    }
  }

  public void chase() {
    int reverseDirection = REVERSE_DIRECTION[direction];

    int minDist = Integer.MAX_VALUE;
    int minDirection = direction;

    for(int i = 0; i < 4; i++) {
      if (i != reverseDirection) {
        switch(i) {
          case Main.UP:
            if (canMoveUp()) {
              int dist = getDist(x, y - 1);
              if (playingMode.getRegionCount(x, y - 1) != 0) {
                dist += 10000000;
              }
              if (dist < minDist) {
                minDist = dist;
                minDirection = Main.UP;
              }
            }
            break;
          case Main.DOWN:
            if (canMoveDown()) {
              int dist = getDist(x, y + 1);
              if (playingMode.getRegionCount(x, y + 16) != 0) {
                dist += 10000000;
              }
              if (dist < minDist) {
                minDist = dist;
                minDirection = Main.DOWN;
              }
            }
            break;
          case Main.LEFT:
            if (canMoveLeft()) {
              int dist = getDist(x - 1, y);
              if (playingMode.getRegionCount(x - 1, y) != 0) {
                dist += 10000000;
              }
              if (dist < minDist) {
                minDist = dist;
                minDirection = Main.LEFT;
              }
            }
            break;
          case Main.RIGHT:
            if (canMoveRight()) {
              int dist = getDist(x + 1, y);
              if (playingMode.getRegionCount(x + 16, y) != 0) {
                dist += 10000000;
              }
              if (dist < minDist) {
                minDist = dist;
                minDirection = Main.RIGHT;
              }
            }
            break;
        }
      }
    }

    direction = minDirection;

    switch(direction) {
      case Main.UP:
        y--;
        break;
      case Main.DOWN:
        y++;
        break;
      case Main.LEFT:
        x--;
        break;
      case Main.RIGHT:
        x++;
        break;
    }

    if (playingMode.distanceToMsPacMan(x, y) < 400) {
      playingMode.playerKilled();
    }
  }

  public boolean intersects(Ghost ghost) {
    return main.intersects(x, y, x + 31, y + 31,
        ghost.x, ghost.y, ghost.x + 31, ghost.y + 31);
  }

  @Override
  public void render(GameContainer gc, Graphics g) throws SlickException {

    if (playingMode.showGhostPoints && playingMode.eatenGhost == this) {
      draw(main.ghostPointsSprites[playingMode.ghostPointsIndex]);
      return;
    }

    if (eyeBalls) {
      draw(main.eyeBallsSprites[direction]);
      if (x > 424) {
        draw(main.eyeBallsSprites[direction], x - 448, y);
      } else if (x < 8) {
        draw(main.eyeBallsSprites[direction], x + 448, y);
      }
      if (y > 472) {
        draw(main.eyeBallsSprites[direction], x, y - 496);
      } else if (y < 8) {
        draw(main.eyeBallsSprites[direction], x, y + 496);
      }
    } else if (blue) {
      int index = spriteIndex + playingMode.ghostsBlueOffset;
      draw(main.blueGhostSprites[index]);
      if (x > 424) {
        draw(main.blueGhostSprites[index], x - 448, y);
      } else if (x < 8) {
        draw(main.blueGhostSprites[index], x + 448, y);
      }
      if (y > 472) {
        draw(main.blueGhostSprites[index], x, y - 496);
      } else if (y < 8) {
        draw(main.blueGhostSprites[index], x, y + 496);
      }
    } else {
      draw(sprites[direction][spriteIndex]);
      if (x > 424) {
        draw(sprites[direction][spriteIndex], x - 448, y);
      } else if (x < 8) {
        draw(sprites[direction][spriteIndex], x + 448, y);
      }
      if (y > 472) {
        draw(sprites[direction][spriteIndex], x, y - 496);
      } else if (y < 8) {
        draw(sprites[direction][spriteIndex], x, y + 496);
      }
    }
  }

  public abstract void updateGhost(GameContainer gc) throws SlickException;

  public void reset() {
    blue = false;
    eyeBalls = false;
    spriteIndex = 0;
    spriteIndexIncrementor = 0;
    targetX = 0;
    targetY = 0;
    inHome = false;
    exitingHome = false;
    enteringHome = false;
    speed = 1f + 0.3f * main.stageIndex / 7;
    speedRemainder = 0f;
  }
}
