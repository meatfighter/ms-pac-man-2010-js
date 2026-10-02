package mspacman;

import java.io.*;
import java.util.*;
import org.newdawn.slick.*;

/** Exercises the real production classes; also run against each archived JAR. */
public final class GhostHouseReturnTest {
  static final class QuietMain extends Main {
    int sounds;
    QuietMain() throws Throwable { super(); }
    @Override public void playSound(Sound sound) { sounds++; }
  }
  static final class ProbeGhost extends Ghost {
    ProbeGhost(PlayingMode world,int index) { super(world,index); }
    @Override public void updateGhost(GameContainer gc) {}
  }
  static final class Eye extends Image {
    int draws;
    Eye() { super(); }
    @Override public void draw(float x,float y) { draws++; }
  }
  static void check(boolean value,String message) { if(!value)throw new AssertionError(message); }
  static PlayingMode world(QuietMain main,int world,int stage) throws Exception {
    PlayingMode w=new PlayingMode();w.main=main;w.homeTree=new int[31][28];w.regionMap=new int[31][28];w.regionCounts=new int[256];
    InputStream resource=GhostHouseReturnTest.class.getResourceAsStream("/stages/stage_"+world+"_"+stage+".dat");
    check(resource!=null,"packaged maze resource");
    try(DataInputStream in=new DataInputStream(resource)) {
      in.readInt();in.readInt();
      for(int[][] map:new int[][][]{w.tileMap,w.regionMap,w.homeTree})for(int y=0;y<31;y++)for(int x=0;x<28;x++)map[y][x]=in.readUnsignedByte();
    }
    for(int y=0;y<31;y++)for(int x=0;x<28;x++)w.typeMap[y][x]=w.tileMap[y][x]==47?0:w.tileMap[y][x]==48?1:w.tileMap[y][x]==49?2:3;
    w.mspacman=new MsPacMan(w);w.mspacman.x=216;w.mspacman.y=176;w.mspacman.speed=1;w.pelletsRemaining=100;w.pelletCountFraction=.001f;
    return w;
  }
  static ProbeGhost ghost(PlayingMode w,int index) {
    ProbeGhost g=new ProbeGhost(w,index);g.reset();g.x=216;g.y=224;g.direction=Main.UP;g.inHome=true;g.exitingHome=true;g.blue=true;return g;
  }
  static void occupancy(PlayingMode w,Ghost g) {
    int[] expected=new int[256];int r=w.regionMap[g.y>>4][g.x>>4];if(r>0)expected[r]++;
    check(Arrays.equals(expected,w.regionCounts),"balanced region transaction");
  }
  public static void main(String[] args) throws Throwable {
    QuietMain main=new QuietMain();
    FruitTarget fruit=new FruitTarget(world(main,0,0));fruit.exitPath=new int[31][28];fruit.exiting=true;fruit.reset();
    check(fruit.exitPath==null&&!fruit.exiting,"retired fruit route cannot cross stage resources");
    for(int index=0;index<4;index++) {
      main.score=main.sounds=0;PlayingMode w=world(main,0,0);ProbeGhost g=ghost(w,index);w.incrementRegionCount(g);
      for(int i=0;g.inHome&&i<200;i++){g.update(null);occupancy(w,g);}
      check(!g.inHome&&g.x==216&&g.y==176&&g.direction==Main.UP,"published exit");
      for(int i=0;!g.eyeBalls&&i<4;i++)g.update(null);
      check(w.showGhostPoints&&w.showGhostPointsTimer==91&&main.score==200&&main.sounds==1,"single real capture");
      g.update(null);check(g.y==176,"points pause");g.moveEyeBalls();check(g.enteringHome&&g.y==176&&!g.inHome,"no doorway departure");
      w.showGhostPoints=false;
      for(int i=0;g.eyeBalls&&i<400;i++){g.update(null);occupancy(w,g);check(g.y>=176&&g.y<=224,"entry lane");}
      check(!g.eyeBalls&&g.inHome&&!g.blue&&!g.enteringHome&&g.exitingHome,"regeneration");
      check(g.y==224&&g.x==(index==2?184:index==3?248:216),"identity slot");check(main.score==200&&main.sounds==1,"no replayed award");
      for(int i=0;g.inHome&&i<300;i++)g.update(null);check(g.x==216&&g.y==176&&!g.inHome,"normal re-exit");
      g.x=184;g.inHome=true;g.y=223;g.moveInHome();check(g.y==224&&g.direction==Main.DOWN,"down alignment facing");
      g.y=225;g.moveInHome();check(g.y==224&&g.direction==Main.UP,"up alignment facing");
      for(int direction=0;direction<4;direction++) {
        g.x=216;g.y=176;g.inHome=false;g.eyeBalls=true;g.enteringHome=false;g.direction=direction;
        g.moveEyeBalls();check(g.enteringHome&&g.y==176&&g.direction==direction,"all doorway headings");
      }
      Eye down=new Eye();main.eyeBallsSprites[Main.DOWN]=down;g.enterHome();g.render(null,null);check(down.draws==1,"production eyes draw direction");
    }
    for(int world=0;world<4;world++)for(int stage=0;stage<8;stage++) {
      PlayingMode w=world(main,world,stage);
      for(int start:new int[]{208,215,217,224}) {
        Ghost g=ghost(w,0);g.x=start;g.y=176;g.inHome=false;g.eyeBalls=true;g.direction=start<216?Main.RIGHT:Main.LEFT;
        for(int i=0;!g.enteringHome&&i<32;i++)g.moveEyeBalls();check(g.enteringHome&&g.x==216&&g.y==176,"authored maze approach");
      }
    }
    System.out.println("GhostHouseReturnTest passed production capture/dispatch, four identities, entry/facing/render and all 32 maze approaches.");
  }
}
