package mspacman;

import org.newdawn.slick.*;
import org.newdawn.slick.util.*;

public class FruitTarget extends Thing {

  public int[][] exitPath;
  public int fruitIndex = 0;
  public int yOffset;
  public float yOffsetAngle;
  public boolean goingAroundHome;
  public boolean clockwise;
  public int aroundHomeIndex;
  public boolean exiting;
  public int eatenTimer;
  public boolean eaten;

  public FruitTarget(PlayingMode playingMode) {
    super(playingMode);

    speed = 0.5f;
  }

  public void reset() {
    eaten = false;
    eatenTimer = 0;
    fruitIndex = 0;
    yOffset = 0;
    yOffsetAngle = 0;
    goingAroundHome = false;
    clockwise = false;
    aroundHomeIndex = 0;
    exiting = false;
  }

  @Override
  public void update(GameContainer gc) throws SlickException {

    float sin = (float)FastTrig.sin(yOffsetAngle);
    yOffset = 3 + (int)(-sin * sin * 6);
    yOffsetAngle += 0.1f;

    speedRemainder += speed;

    while(speedRemainder >= 1f) {

      speedRemainder--;

      if (!eaten && getMsPacManDistance() < 400) {
        main.playSound(main.ateFruitSound);
        eaten = true;
        switch(fruitIndex) {
          case 0:
            playingMode.addPoints(100);
            break;
          case 1:
            playingMode.addPoints(200);
            break;
          case 2:
            playingMode.addPoints(500);
            break;
          case 3:
            playingMode.addPoints(700);
            break;
          case 4:
            playingMode.addPoints(1000);
            break;
          case 5:
            playingMode.addPoints(2000);
            break;
          case 6:
            playingMode.addPoints(5000);
            break;
        }
      }

      if (eaten) {
        if (++eatenTimer >= 91) {
          reset();
          playingMode.fruitTargetExited();          
        }
        return;
      }

      if (exiting) {

        if (x <= -32 || x >= 448 || y <= -32 || y >= 496) {
          reset();
          playingMode.fruitTargetExited();          
          return;
        }

        if ((x & 15) == 0 && (y & 15) == 0) {          
          switch(getExitDirection(x, y)) {
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
      } else if (x < 0) {
        x++;
      } else if (x > 416) {
        x--;
      } else if (y < 0) {
        y++;
      } else if (y > 464) {
        y--;
      } else if (goingAroundHome) {
        if (clockwise) {
          switch(aroundHomeIndex) {
            case 0:
              if (x < 18 * 16) {
                x++;
              } else {
                aroundHomeIndex = 1;
              }
              break;
            case 1:
              if (y < 17 * 16) {
                y++;
              } else {
                aroundHomeIndex = 2;
              }
              break;
            case 2:
              if (x > 9 * 16) {
                x--;
              } else {
                aroundHomeIndex = 3;
              }
              break;
            case 3:
              if (y > 11 * 16) {
                y--;
              } else {
                aroundHomeIndex = 4;
              }
              break;
            case 4:
              if (x < 13 * 16 + 8) {
                x++;
              } else {
                exitPath = playingMode.rightExitMaps[
                    main.random.nextInt(playingMode.rightExitMaps.length)];
                exiting = true;
              }
              break;
          }
        } else {
          switch(aroundHomeIndex) {
            case 0:
              if (x > 9 * 16) {
                x--;
              } else {
                aroundHomeIndex = 1;
              }
              break;
            case 1:
              if (y < 17 * 16) {
                y++;
              } else {
                aroundHomeIndex = 2;
              }
              break;
            case 2:
              if (x < 18 * 16) {
                x++;
              } else {
                aroundHomeIndex = 3;
              }
              break;
            case 3:
              if (y > 11 * 16) {
                y--;
              } else {
                aroundHomeIndex = 4;
              }
              break;
            case 4:
              if (x > 13 * 16 + 8) {
                x--;
              } else {
                exitPath = playingMode.leftExitMaps[
                    main.random.nextInt(playingMode.leftExitMaps.length)];
                exiting = true;
              }
              break;
          }
        }
      } else {
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
          goingAroundHome = true;
          aroundHomeIndex = 0;
          if (direction == Main.RIGHT) {
            clockwise = true;
          } else {
            clockwise = false;
          }
        }
      }
    }
  }

  public int getExitDirection(int x, int y) {
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
    return exitPath[ty][tx];
  }

  @Override
  public void render(GameContainer gc, Graphics g) throws SlickException {
    if (eaten) {
      draw(main.fruitPointsSprites[fruitIndex], x, y);
    } else {
      draw(main.fruitSprites[fruitIndex], x, y + yOffset);
    }
  }
}
