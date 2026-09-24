import assert from "node:assert/strict";
import test from "node:test";
import { methods, executeTs, executeJava } from "./terminal-boundary-test-utils.mjs";
const names = ["IntroMode", "Act4Mode", "AttractMode", "HallOfFameMode"];
const constants =
    "static FADE_NONE=0; static FADE_IN=1; static FADE_OUT=2; static STATE_CLAPPER=0; static STATE_TRAINING=1; static STATE_FLYING_TITLE=0; static STATE_2010=1; static STATE_BARS=2; static STATE_STARING=3; static PAUSE_CENTERED=182;";
const fields = {
    fadeState: 2,
    fadeIndex: 22,
    countDown: 0,
    ticks: 0,
    enterPressed: false,
    state: 1,
    timer: 300,
    mspacmanX: 384,
    dotsOffset: 0,
    redOffset: 0,
    pressEnterDelay: 0,
    pressEnterVisible: false,
    pellotOffset: 0,
    storkX: 0,
    storkY: 0,
    storkYAngle: 0,
    tailCalls: 0
};
function scalars(subject) {
    return JSON.stringify(Object.fromEntries(Object.entries(subject).filter(([, v]) => typeof v === "number" || typeof v === "boolean")));
}
for (const name of names) {
    const wanted = name === "Act4Mode" ? ["update", "updateTraining"] : ["update"];
    test(`TS ${name} relinquishes its stack at setMode`, () => {
        const { Subject, Main } = executeTs(
            `const Main={playingMode:"playing",selectWorldMode:"select",attractMode:"attract"}; const FastTrig={sin:Math.sin}; class ${name} {${constants} ${methods(name, wanted)} } ({Subject:${name},Main});`
        );
        for (const pressed of [false, true])
            for (const terminal of [true, false]) {
                let boundary = null,
                    destination = null;
                const subject = Object.assign(new Subject(), fields, {
                    enterPressed: pressed,
                    fadeIndex: terminal ? 22 : 21,
                    state: name === "Act4Mode" ? 1 : 0
                });
                subject.input = { isMenuStartPressed: () => false };
                subject.main = {
                    demoMode: false,
                    setMode(mode) {
                        boundary = scalars(subject);
                        destination = mode;
                    },
                    fadeMusic() {
                        throw Error("unexpected music fade");
                    }
                };
                for (const helper of ["updateSpriteIndices", "updateFlyingTitle", "update2010", "updateBars", "updateStaring", "updateClapper"])
                    subject[helper] = () => subject.tailCalls++;
                subject.update({});
                if (terminal) {
                    assert.equal(scalars(subject), boundary, `${name}: stale scalar work after setMode`);
                    const expected =
                        name === "HallOfFameMode"
                            ? pressed
                                ? Main.selectWorldMode
                                : Main.attractMode
                            : name === "AttractMode"
                              ? pressed
                                  ? Main.selectWorldMode
                                  : Main.playingMode
                              : Main.playingMode;
                    assert.equal(destination, expected);
                    if (name === "AttractMode" && !pressed) assert.equal(subject.main.demoMode, true);
                } else {
                    assert.equal(boundary, null);
                    assert.equal(subject.fadeIndex, 22);
                }
            }
    });
    test(`Java ${name} terminal and nonterminal paths use real update methods`, () => {
        executeJava(
            `
import java.lang.reflect.*;import java.util.*;
class GameContainer{} class SlickException extends Exception{}
class Input{boolean isMenuStartPressed(){return false;}}
class FastTrig{static float sin(float x){return (float)Math.sin(x);}}
class Music{void play(){}}
class Main{
 static Object playingMode="playing",selectWorldMode="select",attractMode="attract";
 boolean demoMode;String boundary;Object destination;Base owner;Music introMusic=new Music();Object pressedEnterSound;
 void setMode(Object mode,GameContainer gc){boundary=owner.snapshot();destination=mode;}
 void fadeMusic(){throw new AssertionError("unexpected fade");}void playMusic(Object o){}void stopMusic(){}void playSound(Object o){}
}
class Base{
 static final int FADE_NONE=0,FADE_IN=1,FADE_OUT=2,STATE_CLAPPER=0,STATE_TRAINING=1,STATE_FLYING_TITLE=0,STATE_2010=1,STATE_BARS=2,STATE_STARING=3,PAUSE_CENTERED=182;
 Main main=new Main();Input input=new Input();int fadeState=2,fadeIndex=22,countDown,ticks,state=1,timer=300,redOffset,pressEnterDelay,tailCalls;
 boolean enterPressed,pressEnterVisible;float mspacmanX=384,dotsOffset,pellotOffset,storkX,storkY,storkYAngle;
 Base(){main.owner=this;}
 void updateSpriteIndices(){tailCalls++;}void updateFlyingTitle(){tailCalls++;}void update2010(){tailCalls++;}void updateBars(){tailCalls++;}void updateStaring(){tailCalls++;}void updateClapper(){tailCalls++;}
 String snapshot(){try{List<String> rows=new ArrayList<>();for(Field f:Base.class.getDeclaredFields())if(!Modifier.isStatic(f.getModifiers())&&f.getType().isPrimitive())rows.add(f.getName()+"="+f.get(this));return rows.toString();}catch(Exception e){throw new RuntimeException(e);}}
}
class ${name} extends Base {${methods(name, wanted, true)}}
public class ModeHarness{
 public static void main(String[] args)throws SlickException{
  for(boolean pressed:new boolean[]{false,true})for(boolean terminal:new boolean[]{true,false}){
   ${name} s=new ${name}();s.enterPressed=pressed;s.fadeIndex=terminal?22:21;s.state=${name === "Act4Mode" ? 1 : 0};s.update(new GameContainer());
   if(terminal){if(!s.snapshot().equals(s.main.boundary))throw new AssertionError("${name}: stale scalar work after setMode");
    Object expected=${name === "HallOfFameMode" ? "pressed?Main.selectWorldMode:Main.attractMode" : name === "AttractMode" ? "pressed?Main.selectWorldMode:Main.playingMode" : "Main.playingMode"};
    if(s.main.destination!=expected)throw new AssertionError("destination changed");
    ${name === "AttractMode" ? 'if(!pressed&&!s.main.demoMode)throw new AssertionError("demo flag lost");' : ""}
   }else if(s.main.boundary!=null||s.fadeIndex!=22)throw new AssertionError("nonterminal fade changed");
  }
 }
}
`,
            "ModeHarness"
        );
    });
}
