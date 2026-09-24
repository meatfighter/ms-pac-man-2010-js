import test from "node:test";
import { methods, executeJava } from "./terminal-boundary-test-utils.mjs";

test("actual Java terminal gameplay methods preserve scoring, sound ownership, motion fractions and actor boundaries", () => {
    executeJava(
        `
import java.util.*;
class GameContainer {}
class SlickException extends Exception {}
class Input {
  int updates; boolean isConfirmPressed(){return false;}
  boolean isUp(){return false;} boolean isDown(){return false;} boolean isLeft(){return false;} boolean isRight(){return true;}
  void update(){updates++;}
}
class Main {
  static final int UP=0,DOWN=1,LEFT=2,RIGHT=3,RED=0,PINK=1,CYAN=2,ORANGE=3;
  static Object selectWorldMode, hallOfFameMode, enterInitialsMode, attractMode;
  int score,lives=5,stageIndex=7,bonus,fadeCalls; boolean demoMode;
  Random random=new Random(){public float nextFloat(){bonus++;return .99f;}};
  Input input=new Input(); Set<String> sounds=new LinkedHashSet<>();
  String clappingSound="clap",atePellotSound="pellet",ateEnergizerSound="energizer",blueGhostsSound="blue",extraLifeSound="life",ateGhostSound="ghost",fruitAppearedSound="fruit",diedSound="death",pressedEnterSound="enter",gameOverMusic="over";
  void playSound(String s){sounds.add(s);} void stopAllSoundEffects(){sounds.clear();}
  void stopAllSounds(){sounds.clear();} void fadeMusic(){fadeCalls++;} void stopSound(String s){sounds.remove(s);}
  void setMode(Object o,GameContainer gc){} void advanceStage(GameContainer gc){} boolean isHighScore(){return false;} void playMusic(String s){}
}
class Thing {
  Main main; PlayingMode playingMode; int x,y,direction; float speed,speedRemainder;
  int getType(int x,int y){return playingMode.tile;} void setType(int x,int y,int t){playingMode.tile=t;} void setTile(int x,int y,int t){}
  boolean canMoveUp(){return true;} boolean canMoveDown(){return true;} boolean canMoveLeft(){return true;} boolean canMoveRight(){return true;}
}
class MsPacMan extends Thing {
  static final int CHOMP_SPEED=6; Input input=new Input(); int spriteIndex,spriteIndexIncrementor,pellotDampensSpeedCount,corneringEnhancesSpeedCount,speedBoostTimer;
  boolean pellotDampensSpeed,corneringEnhancesSpeed,speedBoost;
  ${methods("MsPacMan", ["update", "boostSpeed", "corneringEnhancesSpeed", "updateSpriteIndexEating", "updateSpriteIndexWalled"], true)}
}
class Ghost extends Thing {
  static final int FLUTTER_SPEED=15; static final int[] REVERSE_DIRECTION={1,0,3,2};
  int ghostIndex,spriteIndex,spriteIndexIncrementor,targetX=216,targetY=368,substeps,calls;
  boolean blue,eyeBalls,inHome,exitingHome,enteringHome;
  void updateGhost(GameContainer gc){substeps++;} void moveRandomly(){} void moveEyeBalls(){x++;} void enterHome(){} void moveInHome(){}
  ${methods("Ghost", ["update", "getDist", "reverseDirection", "chase"], true)}
}
class CountedGhost extends Ghost { public void update(GameContainer gc)throws SlickException{calls++;super.update(gc);} }
class Fruit {int calls;void update(GameContainer gc){calls++;}}
class PlayingMode {
  static final int TYPE_EMPTY=0,TYPE_PELLOT=1,TYPE_ENERGIZER=2,FADE_NONE=0,FADE_IN=1,FADE_OUT=2,FADE_REASON_KILLED=0,FADE_REASON_ADVANCE=1,FADE_REASON_GAME_OVER=2;
  Main main=new Main(); MsPacMan mspacman=new MsPacMan(); Ghost[] ghosts=new Ghost[4]; Fruit fruitTarget=new Fruit(); Ghost eatenGhost;
  boolean finished,finishedWhite,gameOver,playerKilled,playerSpiraling,energizersVisible,showGhostPoints,ghostsBlue,chaseMode,redEnergizerPresent,greenEnergizerPresent,fruitTargetPresent;
  int finishedTimer,finishedBlinkTimer,gameOverTimer,fadeState,fadeIndex,fadeReason,readyTimer,musicFadeOutTimer,spiralTimer,energizersVisibleTimer,exitIndex=4,exitDelay,exitDelayTarget=1,showGhostPointsTimer,ghostsBlueTimer,ghostsBlueOffset,ghostPointsIndex=-1,chaseModeToggleDelay,fruitTargetTimer,energizerTimer,pelletsRemaining,tile,decrements,increments,created;
  float pelletCountFraction=.01f,fruitOdds=.25f,redPelletOdds=.125f;
  int getRegionCount(int x,int y){return 0;} void decrementRegionCount(Ghost g){decrements++;} void incrementRegionCount(Ghost g){increments++;}
  void createFruit(){created++;} void createRedEnergizer(){created++;} void createGreenEnergizer(){created++;} void reset(){}
  ${methods("PlayingMode", ["update", "playerKilled", "atePellot", "ateEnergizer", "addPoints", "ghostEaten", "distance", "distanceToMsPacMan"], true)}
}
public class TerminalHarness {
  static void require(boolean b,String message){if(!b)throw new AssertionError(message);}
  static void fraction(float v){require(Float.isFinite(v)&&v>=0&&v<1,"invalid remainder "+v);}
  static PlayingMode setup(int tile,int pellets,boolean contact,int bonus,boolean boost,int score){
    PlayingMode w=new PlayingMode();w.tile=tile;w.pelletsRemaining=pellets;w.main.score=score;
    w.redEnergizerPresent=bonus==1;w.greenEnergizerPresent=bonus==2;w.fruitTargetPresent=bonus==3;w.fruitTargetTimer=bonus==4?909:0;
    MsPacMan p=w.mspacman;p.main=w.main;p.playingMode=w;p.x=216;p.y=368;p.direction=Main.RIGHT;p.speed=1.75f;p.speedRemainder=.9f;p.speedBoost=boost;
    for(int i=0;i<4;i++){Ghost g=w.ghosts[i]=new CountedGhost();g.main=w.main;g.playingMode=w;g.ghostIndex=i;g.x=contact&&i==0?217:400;g.y=contact&&i==0?368:100;g.direction=Main.LEFT;g.speed=1.3f;g.speedRemainder=.9f;}
    return w;
  }
  static void noBonus(PlayingMode w){require(w.created+w.fruitTarget.calls+w.main.bonus+w.energizerTimer==0,"bonus tail ran");}
  public static void main(String[] args)throws SlickException {
    GameContainer gc=new GameContainer();
    for(int tile=1;tile<=2;tile++){
      PlayingMode w=setup(tile,1,true,0,true,0);w.update(gc);
      require(w.finished&&!w.playerKilled,"completion followed by death");require(w.main.score==(tile==2?60:10),"tile points");
      require(w.main.sounds.equals(Set.of("clap")),"completion audio");
      require(w.mspacman.x==216&&w.mspacman.y==368&&w.mspacman.input.updates==0,"post-completion player work");
      fraction(w.mspacman.speedRemainder);for(Ghost g:w.ghosts)require(g.calls==0,"post-completion ghost");noBonus(w);
    }
    for(int bonus=1;bonus<=4;bonus++){
      PlayingMode w=setup(0,5,true,bonus,false,0);w.update(gc);
      require(w.playerKilled&&!w.finished&&w.main.score==0,"death award/completion");
      require(w.ghosts[0].calls==1&&w.ghosts[0].substeps==1,"killing ghost continued");
      for(int i=1;i<4;i++)require(w.ghosts[i].calls==0,"later ghost ran");
      require(w.main.fadeCalls==1&&w.decrements==1&&w.increments==1,"death/region imbalance");
      fraction(w.ghosts[0].speedRemainder);noBonus(w);
      if(bonus==1)require(w.redEnergizerPresent,"red consumed");if(bonus==2)require(w.greenEnergizerPresent,"green consumed");if(bonus==4)require(w.fruitTargetTimer==909,"spawn timer advanced");
    }
    PlayingMode w=setup(0,5,true,1,false,9950);w.main.lives=0;w.update(gc);require(w.playerKilled&&w.main.score==9950&&w.main.lives==0,"manufactured reserve");
    for(int tile=0;tile<=2;tile++){
      w=setup(tile,5,false,0,false,0);w.update(gc);require(!w.finished&&!w.playerKilled,"normal gameplay terminated");
      require(w.main.score==(tile==2?60:tile==1?10:0)&&w.pelletsRemaining==(tile==0?5:4),"normal scoring");
      require(w.mspacman.x>216&&w.ghostsBlue==(tile==2),"normal motion/energizer");fraction(w.mspacman.speedRemainder);for(Ghost g:w.ghosts)require(g.calls==1,"normal ghost order");
    }
    w=setup(2,1,false,0,false,9950);w.update(gc);require(w.main.score==10010&&w.main.lives==6&&w.main.sounds.equals(Set.of("clap")),"final energizer reserve/audio");
    w=setup(0,5,false,0,false,0);w.finished=true;w.playerKilled();require(!w.playerKilled&&w.main.fadeCalls==0,"death superseded completion");w.finished=false;w.playerKilled();w.musicFadeOutTimer=12;w.spiralTimer=3;w.playerKilled();require(w.main.fadeCalls==1&&w.musicFadeOutTimer==12&&w.spiralTimer==3,"duplicate death");
    // A legitimate .9 remainder plus tunnel speed crosses one pixel. The
    // real chase collision kills at -32 before wrapping to 416.
    w=setup(0,5,false,0,false,0);Ghost g=w.ghosts[0];g.x=-31;g.y=368;g.targetX=-32;g.targetY=368;w.mspacman.x=-32;g.update(gc);
    require(w.playerKilled&&g.x==416&&w.decrements==1&&w.increments==1,"killing wrap/region transaction");fraction(g.speedRemainder);
    w=setup(0,5,false,0,false,0);w.showGhostPoints=true;w.showGhostPointsTimer=20;w.eatenGhost=w.ghosts[0];w.ghosts[0].eyeBalls=true;w.ghosts[1].eyeBalls=true;w.update(gc);
    require(w.mspacman.input.updates==0&&w.ghosts[0].substeps==0&&w.ghosts[1].substeps>0,"points pause froze returning eyes");
    // Compile and exercise the compatible no-argument overload too.
    w=setup(0,5,false,0,false,0);w.atePellot();require(w.main.score==10&&w.pelletsRemaining==4,"ordinary overload");
  }
}
`,
        "TerminalHarness"
    );
});
