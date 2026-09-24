package mspacman;

import org.newdawn.slick.*;

public class MsPacMan extends Thing {

  public static final int[] spritePattern = { 0, 1, 2, 1 };
  public static final int CHOMP_SPEED = 6;

  public IInput input;
  public int spriteIndex;
  public int spriteIndexIncrementor;

  public boolean pellotDampensSpeed;
  public int pellotDampensSpeedCount;
  public boolean corneringEnhancesSpeed;
  public int corneringEnhancesSpeedCount;
  public boolean speedBoost;
  public int speedBoostTimer;

  public MsPacMan(PlayingMode playingMode) {
    super(playingMode);
  }

  public void reset() {

    this.input = playingMode.input;

    x = 16 * 13 + 8;
    y = 16 * 23;

    speed = 1.25f + 0.5f * main.stageIndex / 7;
    speedRemainder = 0f;
    direction = Main.LEFT;

    spriteIndex = 0;
    spriteIndexIncrementor = 0;
    pellotDampensSpeed = false;
    pellotDampensSpeedCount = 0;
    corneringEnhancesSpeed = false;
    corneringEnhancesSpeedCount = 0;
    speedBoost = false;
    speedBoostTimer = 0;
  }

  @Override
  public void update(GameContainer gc) throws SlickException {

    if (playingMode.showGhostPoints) {
      return;
    }

    float speed = this.speed;
    float speedPercentChange = 1f;

    if (pellotDampensSpeed) {
      speedPercentChange -= 0.1f;
      if (--pellotDampensSpeedCount == 0) {
        pellotDampensSpeed = false;
      }
    }
    if (corneringEnhancesSpeed) {
      speedPercentChange += 0.1f;
      if (--corneringEnhancesSpeedCount == 0) {
        corneringEnhancesSpeed = false;
      }
    }
    if (playingMode.ghostsBlue) {
      speedPercentChange += 0.1f;
    }
    if (speedBoost) {
      if (++speedBoostTimer == 91 * 7) {
        speedBoostTimer = 0;
        speedBoost = false;
      }
      speedPercentChange += 0.6f;
    }
    if (speedPercentChange != 1f) {
      speed *= speedPercentChange;
    }

    speedRemainder += speed;

    while(speedRemainder >= 1f) {

      speedRemainder--;

      int type = getType(x + 8, y + 8);
      if (type == PlayingMode.TYPE_PELLOT
          || type == PlayingMode.TYPE_ENERGIZER) {
        setType(x + 8, y + 8, PlayingMode.TYPE_EMPTY);
        setTile(x + 8, y + 8, 47);
        playingMode.atePellot(type == PlayingMode.TYPE_ENERGIZER);
        if (playingMode.finished) {
          // Cancel remaining whole-pixel work, retaining the fractional remainder.
          speedRemainder %= 1f;
          return;
        }
        if (type == PlayingMode.TYPE_PELLOT) {
          main.playSound(main.atePellotSound);
          pellotDampensSpeed = true;
          pellotDampensSpeedCount = 10;
        }
      }

      boolean isUp = input.isUp();
      boolean isDown = input.isDown();
      boolean isLeft = input.isLeft();
      boolean isRight = input.isRight();
      input.update();

      int targetDirection = direction;
      if (isUp) {
        targetDirection = Main.UP;
      } else if (isDown) {
        targetDirection = Main.DOWN;
      } else if (isLeft) {
        targetDirection = Main.LEFT;
      } else if (isRight) {
        targetDirection = Main.RIGHT;
      }

      if (direction != targetDirection) {
        switch(targetDirection) {
          case Main.UP:
            if (canMoveUp()) {
              direction = Main.UP;
              corneringEnhancesSpeed();
            }
            break;
          case Main.DOWN:
            if (canMoveDown()) {
              direction = Main.DOWN;
              corneringEnhancesSpeed();
            }
            break;
          case Main.LEFT:
            if (canMoveLeft()) {
              direction = Main.LEFT;
              corneringEnhancesSpeed();
            }
            break;
          case Main.RIGHT:
            if (canMoveRight()) {
              direction = Main.RIGHT;
              corneringEnhancesSpeed();
            }
            break;
        }
      }

      switch(direction) {
        case Main.UP:
          if (canMoveUp()) {
            y--;
            updateSpriteIndexEating();
          } else {
            updateSpriteIndexWalled();
          }
          break;
        case Main.DOWN:
          if (canMoveDown()) {
            y++;
            updateSpriteIndexEating();
          } else {
            updateSpriteIndexWalled();
          }
          break;
        case Main.LEFT:
          if (canMoveLeft()) {
            x--;
            updateSpriteIndexEating();
          } else {
            updateSpriteIndexWalled();
          }
          break;
        case Main.RIGHT:
          if (canMoveRight()) {
            x++;
            updateSpriteIndexEating();
          } else {
            updateSpriteIndexWalled();
          }
          break;
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
    }
  }

  public void boostSpeed() {
    speedBoost = true;
    speedBoostTimer = 0;
  }

  private void corneringEnhancesSpeed() {
    corneringEnhancesSpeed = true;
    corneringEnhancesSpeedCount = 10;
  }

  private void updateSpriteIndexWalled() {
    if (spriteIndex == 1 || spriteIndex == 3) {
      return;
    }
    updateSpriteIndexEating();
  }

  private void updateSpriteIndexEating() {
    if (++spriteIndexIncrementor == CHOMP_SPEED) {
      spriteIndexIncrementor = 0;
      if (++spriteIndex == 4) {
        spriteIndex = 0;
      }
    }
  }

  @Override
  public void render(GameContainer gc, Graphics g) throws SlickException {

    if (playingMode.showGhostPoints) {      
      return;
    }

    draw(main.mspacmanSprites[direction][spritePattern[spriteIndex]]);
    if (x > 424) {
      draw(main.mspacmanSprites[direction][spritePattern[spriteIndex]],
          x - 448, y);
    } else if (x < 8) {
      draw(main.mspacmanSprites[direction][spritePattern[spriteIndex]],
          x + 448, y);
    }
    if (y > 472) {
      draw(main.mspacmanSprites[direction][spritePattern[spriteIndex]],
          x, y - 496);
    } else if (y < 8) {
      draw(main.mspacmanSprites[direction][spritePattern[spriteIndex]],
          x, y + 496);
    }
  }

}
