package mspacman;

import org.newdawn.slick.*;

public class LoadingMode implements IMode {

  private Main main;
  private int loadIndex;

  public void init(Main main, GameContainer gc) throws SlickException {
    this.main = main;
    loadIndex = 14;
  }

  public void update(GameContainer gc) throws SlickException {
    switch(loadIndex) {
      case 0:
        main.setMode(Main.attractMode, gc);
        /*
        main.worldIndex = 3;
        main.stageIndex = 3;
        main.setMode(Main.playingMode, gc); // RECORD
        */
        break;
      case 1:
        main.actMusic[0] = new Music("music/act_1.ogg");
        break;
      case 2:
        main.actMusic[1] = new Music("music/act_2.ogg");
        break;
      case 3:
        main.actMusic[2] = new Music("music/act_3.ogg");
        break;
      case 4:
        main.stageMusic[0] = new Music("music/stage_1.ogg");
        break;
      case 5:
        main.stageMusic[1] = new Music("music/stage_2.ogg");
        break;
      case 6:
        main.stageMusic[2] = new Music("music/stage_3.ogg");
        break;
      case 7:
        main.stageMusic[3] = new Music("music/stage_4.ogg");
        break;
      case 8:
        main.trainingMusic = new Music("music/training.ogg");
        break;
      case 9:
        main.introMusic = new Music("music/intro.ogg");
        break;
      case 10:
        main.highScoreMusic = new Music("music/high_score.ogg");
        break;
      case 11:
        main.gameOverMusic = new Music("music/game_over.ogg");
        break;
      case 12:
        main.levelSelectMusic = new Music("music/level_select.ogg");
        break;
      case 13:
        main.downloadScores();
        break;
      case 14:
        break;
    }
    loadIndex--;
    main.resetNextFrameTime();
  }

  public void render(GameContainer gc, Graphics g) throws SlickException {
    g.setColor(Color.white);
    g.drawRect(328, 276, 144, 48);
    g.setColor(Color.blue);
    g.fillRect(329, 277, 143 * (1f - loadIndex / 14f), 47);
    main.drawString("LOADING", 344, 292, Main.RED);
  }
}
