import React, { useEffect, useRef, useState } from 'react';
import Matter, { Engine } from 'matter-js';
import { Eraser, Pen, Pin, ChevronLeft, ChevronRight, RefreshCw, Hand, Circle, Link } from 'lucide-react';
import axios from 'axios';
import { useSocket } from '../context/SocketContext';
import { levelFactories } from './levels';
// import Timer from './Timer';

interface LogInfo {
  player_number: number,
  type: 'draw' | 'erase' | 'push' | 'refresh' | 'move_prev_level' | 'move_next_level',
  timestamp: Date,
}

declare module 'matter-js' {
  interface Body {
    eraserEmitted?: boolean;
  }
}
declare module 'matter-js' {
  // IConstraintDefinition 에 collideConnected 옵션을 추가
  interface IConstraintDefinition {
    /**
     * If true, the two bodies connected by this constraint will still
     * collide with each other (default is false).
     */
    collideConnected?: boolean;
  }
}
const TOTAL_LEVELS = 20; // 총 스테이지 수를 정의합니다.
const p1 = 'player1'
const p2 = 'player2'
// 맵이 변할 때 마다 실행됨.
const PhysicsCanvas: React.FC = () => {
  const socket = useSocket();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef1 = useRef<HTMLCanvasElement>(null);
  const canvasRef2 = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef(Matter.Engine.create({
    gravity: { x: 0, y: 1, scale: 0.001 },
  }));
  const engineRef1 = useRef(Matter.Engine.create({ gravity: { x: 0, y: 1, scale: 0.001 } }));
  const engineRef2 = useRef(Matter.Engine.create({ gravity: { x: 0, y: 1, scale: 0.001 } }));
  const renderRef1 = useRef<Matter.Render | null>();
  const renderRef2 = useRef<Matter.Render | null>();
  const runnerRef1 = useRef<Matter.Runner | null>(null);
  const runnerRef2 = useRef<Matter.Runner | null>(null);
  const renderRef = useRef<Matter.Render | null>();
  const runnerRef = useRef<Matter.Runner | null>(null);
  const [tool, setTool] = useState<'pen' | 'eraser' | 'pin' | 'chain' | 'push'>('pen');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPoints, setDrawPoints] = useState<Matter.Vector[]>([]);
  const [currentLevel, setCurrentLevel] = useState(1);
  const currentLevelRef = useRef<number>(1);
  const [resetTrigger, setResetTrigger] = useState(false);
  const [gameEnded, setGameEnded] = useState(false);
  const [currentTurn, setCurrentTurn] = useState<string>(p2);
  const [pushLock, setPushLock] = useState(false);
  const [drawLock, setDrawLock] = useState(false);
  const [completedLevels, setCompletedLevels] = useState<number[]>([]);
  // chain 이벤트가 이미 emit 되었는지 여부 플래그 (중복 방지)
  const chainEmittedRef = useRef<boolean>(false);
  
  // const [cursors, setCursors] = useState<{ playerId: string; x: number; y: number }[]>([]);
  // const [cursors, setCursors] = useState<{ playerId: string; x: number; y: number }[]>([]);
  const [cursors, setCursors] = useState<{ playerId: string; x: number; y: number; timestamp: number }[]>([]);
  const CURSOR_LIFETIME = 2000; // 2초
  
  const initialBallPositionRef = useRef({ x: 0, y: 0 }); // 공 초기 위치 저장
  
  const mapObjects = ['ground', 'tower1', 'tower2', 'tower3', 'tower4', 'tower5', 'base', 'pedestal', 'top_bar', 'vertical_bar', 'red_box', 'left_up_green_platform', 'left_down_green_platform', 'right_up_green_platform', 'right_down_green_platform', 'left_red_wall', 'right_red_wall', 'bottom_red_wall', 'red_platform', 'green_ramp', 'central_obstacle', 'wall_bottom', 'wall_top', 'wall_left', 'wall_right', 'horizontal_platform', 'frame_top', 'frame_left', 'frame_right', 'horizontal_down_platform', 'pillar1', 'pillar2', 'pillar3', 'rounded_slope', 'horizontal_down_platform', 'horizontal_up_platform', 'nail4_0', 'nail4_1', 'nail4_2', 'nail8_0', 'horizontalPlatformForBall', 'horizontalPlatform', 'slope', 'horizontalPlatformForStar', 'cloud', 'scoop', 'obstacle', 'floor', 'Ishape', 'upperrectangle', 't_shape', 'nail7_0', 'nail7_1'];
  const staticObjects = ['wall', 'ball', 'balloon','nail'].concat(mapObjects);
  const ballRef = useRef<Matter.Body | null>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // const [startTimer, setStartTimer] = useState<boolean>(false);
  // const [isFinished, setIsFinished] = useState<boolean>(false);

  // A list to store the selected pins
  const [selectedPins, setSelectedPins] = useState<Matter.Body[]>([]);

  // 못(nail)들을 저장하는 상태
  const [nails, setNails] = useState<Matter.Body[]>([]);
  const nailsRef = useRef<Matter.Body[]>([]);

  // nail 추가 함수
  // const addNail = (nail: Matter.Body) => {
  //   nailsRef.current = [...nailsRef.current, nail];
  //   setNails(nailsRef.current); // 상태 업데이트도 유지
  // };
  const addNail = (nail: Matter.Body) => {
    // 이미 같은 label이 존재하는지 확인
    const exists = nailsRef.current.some(existingNail => existingNail.label === nail.label);
    
    if (!exists) {
      nailsRef.current = [...nailsRef.current, nail];
      setNails(nailsRef.current); // 상태 업데이트도 유지
    }
  };

  // nails에서 특정 nail 삭제 함수
  const removeNail = (nail: Matter.Body) => {
    nailsRef.current = nailsRef.current.filter((n) => n !== nail); // 참조값 업데이트
    setNails(nailsRef.current); // 상태 업데이트
  };

  // nails 상태 초기화 함수
  const resetNails = () => {
    nailsRef.current = []; // 참조값 초기화
    setNails([]); // 상태도 초기화
  };

  useEffect(() => {
    if (currentLevelRef.current === 411 || currentLevelRef.current === 412) {
      // ----- 위쪽 맵 세팅 -----
      if (renderRef1.current) {
        Matter.Render.stop(renderRef1.current);
        renderRef1.current = null;
      }
      const render1 = Matter.Render.create({
        canvas: canvasRef1.current!,
        engine: engineRef1.current,
        options: { width: 800, height: 300, wireframes: false, background: '#f8f4e3' },
      });
      renderRef1.current = render1;
      if (runnerRef1.current) Matter.Runner.stop(runnerRef1.current);
      runnerRef1.current = Matter.Runner.create();
      // Matter.Runner.run(runnerRef1.current, engineRef1.current);
      Matter.Render.run(render1);
  
      // 월드 초기화 & 맵 생성
      Matter.World.clear(engineRef1.current.world, false);
      Matter.Engine.clear(engineRef1.current);
      const factory = levelFactories[11];
      if (factory){
        const bodies = factory(engineRef1.current.world);   // ← returns all the bodies you just made
        bodies.forEach(body => {
          if (body.label === 'ball') {
            if(currentLevelRef.current === 411) {
              ballRef.current = body;      // ← and you’ll need this too for push/afterUpdate!
            
              initialBallPositionRef.current = {
                x: body.position.x,
                y: body.position.y
              };  
            }
          }
        });
      }
  
      // ----- 아래쪽 맵 세팅 -----
      if (renderRef2.current) {
        Matter.Render.stop(renderRef2.current);
        renderRef2.current = null;
      }
      const render2 = Matter.Render.create({
        canvas: canvasRef2.current!,
        engine: engineRef2.current,
        options: { width: 800, height: 300, wireframes: false, background: '#e3f4f8' },
      });
      renderRef2.current = render2;
      if (runnerRef2.current) Matter.Runner.stop(runnerRef2.current);
      runnerRef2.current = Matter.Runner.create();
      // Matter.Runner.run(runnerRef2.current, engineRef2.current);
      Matter.Render.run(render2);
  
      Matter.World.clear(engineRef2.current.world, false);
      Matter.Engine.clear(engineRef2.current);
      const factory2 = levelFactories[12];
      if (factory2){
        const bodies = factory2(engineRef2.current.world);   // ← returns all the bodies you just made
        bodies.forEach(body => {
          if (body.label === 'ball') {
            if(currentLevelRef.current === 412) {
              ballRef.current = body;      // ← and you’ll need this too for push/afterUpdate!
            
              initialBallPositionRef.current = {
                x: body.position.x,
                y: body.position.y
              };  
            }
          }
        });
      }
  
      // cleanup
      return () => {
        if (renderRef1.current) Matter.Render.stop(renderRef1.current);
        if (runnerRef1.current) Matter.Runner.stop(runnerRef1.current);
        if (renderRef2.current) Matter.Render.stop(renderRef2.current);
        if (runnerRef2.current) Matter.Runner.stop(runnerRef2.current);
        Matter.World.clear(engineRef1.current.world, false);
        Matter.Engine.clear(engineRef1.current);
        Matter.World.clear(engineRef2.current.world, false);
        Matter.Engine.clear(engineRef2.current);
      };
    }
    // 기존 single-canvas 렌더링 로직은 else에서!
  }, [currentLevel, resetTrigger]);
  
  useEffect(() => {
    if(gameEnded) {
      socket.emit('completeLevel', {
        completedLevel: currentLevel,
        playerId: p1,
      });
    }
  }, [gameEnded])

  // -----------------------------------------------
  // 2) 서버에서 "completedLevelsResponse" 받기
  //    => completedLevels 업데이트
  // -----------------------------------------------
  useEffect(() => {
    // 'completedLevelsResponse' => 서버가 getCompletedLevels 요청에 대한 응답을 준다
    socket.on('completedLevelsResponse', (data: { levels: number[] }) => {
      console.log('Received completed levels:', data.levels);
      setCompletedLevels(data.levels);
    });

    // 'completedLevelsUpdated' => 누군가 completeLevel 하면,
    // 서버가 전체 클라이언트에 브로드캐스트할 수도 있음
    socket.on('completedLevelsUpdated', (data: { levels: number[] }) => {
      console.log('completedLevelsUpdated:', data.levels);
      setCompletedLevels(data.levels);
    });

    // 컴포넌트 마운트 시점에 "getCompletedLevels" 이벤트로 요청
    socket.emit('getCompletedLevels');

    return () => {
      socket.off('completedLevelsResponse');
      socket.off('completedLevelsUpdated');
    };
  }, [socket]);

  useEffect(() => {
    socket.on('createChain', (data: { playerId: string, customId: string, pinAId: string, pinBId: string, stiffness: number, damping: number, length: number, currentLevel: number }) => {
      console.log('Received createChain from server:', data);
  
      // 1) pinA, pinB를 label로 찾아서 Body 객체를 얻는다
      const pinA = Matter.Composite.allBodies(engineRef.current.world)
                     .find(b => b.label === data.pinAId);
      const pinB = Matter.Composite.allBodies(engineRef.current.world)
                     .find(b => b.label === data.pinBId);
  
      if (!pinA || !pinB) {
        console.warn('Could not find pinA or pinB in local world:', data.pinAId, data.pinBId);
        return;
      }
  
      // 2) Constraint 생성
      const chain = Matter.Constraint.create({
        bodyA: pinA,
        bodyB: pinB,
        stiffness: data.stiffness,
        damping: data.damping,
        length: data.length,
        render: {
          visible: true,
          lineWidth: 4,
          strokeStyle: '#8B0000',
        },
        label: data.customId,
      });
  
      if(currentLevelRef.current === 411) {
        Matter.World.add(engineRef1.current.world, chain);
      } else if(currentLevelRef.current === 412) {
        Matter.World.add(engineRef2.current.world, chain);
      } else {
        // 3) Matter.World에 추가
        Matter.World.add(engineRef.current.world, chain);
      }
    });
  
    return () => {
      socket.off('createChain');
    };
  }, [socket]);

  useEffect(() => {
    socket.emit('getTurn'); // 현재 턴 정보 요청
  
    socket.on('updateTurn', (data: { currentTurn: string }) => {
      console.log('Current turn:', data.currentTurn);
      setCurrentTurn(data.currentTurn); // 클라이언트 상태 업데이트
    });
  
    return () => {
      socket.off('updateTurn');
    };
  }, []);

  // Socket 이벤트 처리
  useEffect(() => {
    socket.on('mouseMove', (data: { x: number; y: number; playerId: string }) => {
      if(data.playerId !== p2) return;
      const timestamp = Date.now();
      // console.log("data: ", data);
      setCursors((prevCursors) => {
        const now = Date.now();
        const filteredCursors = prevCursors.filter((cursor) => now - cursor.timestamp < CURSOR_LIFETIME);

      const updatedCursors = filteredCursors.filter((cursor) => cursor.playerId !== data.playerId);
      return [...updatedCursors, { ...data, timestamp }];
      
      });
    });

    return () => {
      socket.off('mouseMove');
    };
  }, []);


  useEffect(() => {
  socket.on('drawShape', (data: {
    playerId: string;
    customId: string;
    currentLevel: number;
    collisionCategory?: number;
    groupNumber?: number;
    // Level-6 전용 필드
    centerX?: number;
    centerY?: number;
    // 기존 points (다각형용)
    points: Matter.Vector[];
  }) => {
    if (data.playerId === p1) return
    // ─── Level 6 전용: centerX/Y 로 사각형 그리기 ───
    if ((data.currentLevel === 6 || data.currentLevel === 18) && data.centerX != null && data.centerY != null) {
      const square = Matter.Bodies.rectangle(
        data.centerX, data.centerY,
        80, 80,
        {
          render: {
            fillStyle: 'rgba(0,0,0,0)',
            strokeStyle: '#1d4ed8',
            lineWidth: 1,
          },
          collisionFilter: {
            group: data.groupNumber ?? 0,
            category: data.collisionCategory ?? 0x0001,
            mask: (data.collisionCategory === 0x0001)
              ? 0xFFFF
              : (0xFFFF & ~data.collisionCategory!),
          },
          label: data.customId,
        }
      );
      if(currentLevelRef.current === 411) {
        Matter.World.add(engineRef1.current.world, square);
      } else if(currentLevelRef.current === 412) {
        Matter.World.add(engineRef2.current.world, square);
      } else {
        Matter.World.add(engineRef.current.world, square);
      }
      return;
    }
    // ────────────────────────────────────────────────

    // 나머지 (points 기반 다각형) 기본 처리
    const result = createPhysicsBody(
      data.points,
      false,
      data.collisionCategory ?? 0x0001,
      data.groupNumber ?? 0,
      data.customId
    ) as { body: Matter.Body; nailsInShape: Matter.Body[] } | null;
    if (result && result.body) {
      if(currentLevelRef.current === 411) {
        Matter.World.add(engineRef1.current.world, result.body);
      } else if(currentLevelRef.current === 412) {
        Matter.World.add(engineRef2.current.world, result.body);
      } else {
        Matter.World.add(engineRef.current.world, result.body);
      }
      // nailsInShape 제약조건 처리 등…
      result.nailsInShape.forEach(nail => {
        const ct = Matter.Constraint.create({
          bodyA: result.body,
          pointA: { x: nail.position.x - result.body.position.x, y: nail.position.y - result.body.position.y },
          bodyB: nail,
          pointB: { x: 0, y: 0 },
          stiffness: 1,
          length: 0,
          render: { visible: false },
          collideConnected: false,
        });
        if(currentLevelRef.current === 411) {
          Matter.World.add(engineRef1.current.world, ct);
        } else if(currentLevelRef.current === 412) {
          Matter.World.add(engineRef2.current.world, ct);
        } else {
          Matter.World.add(engineRef.current.world, ct);
        }
      });
    }
  });

  return () => {
    socket.off('drawShape');
  };
}, [socket]);

useEffect(() => {
  // drawPin 이벤트 처리
  const handleDrawPin = (data: {
    customId: string;
    centerX: number;
    centerY: number;
    radius: number;
    category: number;
    groupNumber: number;
    playerId: string;
    currentLevel: number;
  }) => {
    
    console.log("Received drawPin data:", data);

    // 1) 못을 붙일 대상 몸체 찾기
    const mousePosition = { x: data.centerX, y: data.centerY };
    const bodies = Matter.Composite.allBodies(engineRef.current.world);
    const targetBody = bodies.find(body =>
      Matter.Bounds.contains(body.bounds, mousePosition)
    );
    if (!targetBody) {
      console.log("No body found under nail position.");
      return;
    }

    if (currentLevelRef.current === 48 && targetBody.label === 'lever') {
      data.radius = 10;
    }

    if (currentLevelRef.current === 419 && targetBody.label === 'Tshape') {
      data.radius = 10;
      data.centerX = targetBody.position.x;
    }

    // 2) 못 생성 (물리 충돌 모두 끔)
    let nail = Matter.Bodies.circle(data.centerX, data.centerY, data.radius, {
      isStatic: targetBody.isStatic,      // 타겟과 동일하게
      collisionFilter: {
        group: data.groupNumber,
        category: data.category,
        mask: 0x0000,                     // 어떤 것도 충돌하지 않음
      },
      render: {
        fillStyle: 'rgba(0,0,0,0.0)',
        strokeStyle: '#fbbf24',
        lineWidth: 3,
      },
      label: data.customId,
      mass: 30,
    });
    // 월드에 추가 및 상태 업데이트
    if(currentLevelRef.current === 48 && targetBody.label === 'lever') {
      
      nail.label += '_fulcrum';
      nail.isStatic = true; // 레버의 축 역할을 하기 때문에 정적이어야 함
      Matter.Composite.add(engineRef.current.world, nail);

      const lever = bodies.find(body => body.label === 'lever')

      // 8) 힌지 연결
      if(lever) {
        const pivot = Matter.Constraint.create({
          bodyA: lever,
          pointA: { x: nail.position.x - lever.position.x, y: nail.position.y-lever.position.y },
          bodyB: nail,
          pointB: { x: 0, y: 0 },
          length: 0,
          stiffness: 1,
          render: { visible: true },
        });
        Matter.Composite.add(engineRef.current.world, pivot);
      }

      const fulcrum = bodies.find(body => body.label === 'fulcrum' || body.label.includes('fulcrum'));
      const constraints = Matter.Composite.allConstraints(engineRef.current.world);
      const leverPivot = constraints.find(ct => ct.label === 'leverPivot');
      if(fulcrum && leverPivot) {
        Matter.Composite.remove(engineRef.current.world, fulcrum);
        Matter.Composite.remove(engineRef.current.world, leverPivot);
      }
    } else if(currentLevelRef.current === 419 && targetBody.label === 'Tshape') {
      nail.label += '_Tshape';
      nail.isStatic = true; // tshape의 축 역할을 하기 때문에 정적이어야 함
      Matter.Composite.add(engineRef.current.world, nail);

      const Tshape = bodies.find(body => body.label === 'Tshape')

      // 8) 힌지 연결
      if(Tshape) {
        const pivot = Matter.Constraint.create({
          bodyA: Tshape,
          pointA: { x: nail.position.x - Tshape.position.x, y: nail.position.y-Tshape.position.y },
          bodyB: nail,
          pointB: { x: 0, y: 0 },
          length: 0,
          stiffness: 1,
          render: { visible: true },
        });
        Matter.Composite.add(engineRef.current.world, pivot);
      }

      const nailTshape = bodies.find(body => body.label === 'nail_Tshape' || body.label.includes('_Tshape'));
      const constraints = Matter.Composite.allConstraints(engineRef.current.world);
      const constraintTshape = constraints.find(ct => ct.label === 'constraint_Tshape');
      if(nailTshape && constraintTshape) {
        Matter.Composite.remove(engineRef.current.world, nailTshape);
        Matter.Composite.remove(engineRef.current.world, constraintTshape);
      }
    } else {
      Matter.Composite.add(engineRef.current.world, nail);
    }
    addNail(nail);

    // 3) Constraint로 고정
    const constraint = Matter.Constraint.create({
      bodyA: targetBody,
      pointA: {
        x: data.centerX - targetBody.position.x,
        y: data.centerY - targetBody.position.y,
      },
      bodyB: nail,
      pointB: { x: 0, y: 0 },
      length: 0,
      stiffness: 1,
      render: { visible: false },
      collideConnected: false,
      label: currentLevelRef.current === 48 && targetBody.label === 'lever' ? 'leverPivot' : currentLevelRef.current === 18 && targetBody.label === 'Tshape' ? 'constraint_Tshape' : '',
    });
    Matter.Composite.add(engineRef.current.world, constraint);
  };

  socket.on('drawPin', handleDrawPin);
  return () => {
    socket.off('drawPin', handleDrawPin);
  };
}, [socket]);

  useEffect(() => {
    socket.on('resetLevel', (data: { level: number }) => {
      console.log(`Resetting level to: ${data.level}`);
      
      if(currentLevelRef.current === 411) {
        // 월드와 렌더를 정지하고 지운 후, 다시 설정
        const world = engineRef1.current.world;
        Matter.World.clear(world, false);
        Matter.Engine.clear(engineRef1.current);
    
        if (renderRef1.current) {
          Matter.Render.stop(renderRef1.current);
          Matter.Render.run(renderRef1.current);
        }

        resetNails();
    
        // 수신한 레벨로 초기화
        setCurrentLevel(data.level);
        currentLevelRef.current = data.level //
        setResetTrigger((prev) => !prev);
      } else if (currentLevelRef.current === 412) {
        // 월드와 렌더를 정지하고 지운 후, 다시 설정
        const world = engineRef2.current.world;
        Matter.World.clear(world, false);
        Matter.Engine.clear(engineRef2.current);
    
        if (renderRef2.current) {
          Matter.Render.stop(renderRef2.current);
          Matter.Render.run(renderRef2.current);
        }

        resetNails();
    
        // 수신한 레벨로 초기화
        setCurrentLevel(data.level);
        currentLevelRef.current = data.level //
        setResetTrigger((prev) => !prev);
      } else {
        // 월드와 렌더를 정지하고 지운 후, 다시 설정
        const world = engineRef.current.world;
        Matter.World.clear(world, false);
        Matter.Engine.clear(engineRef.current);
    
        if (renderRef.current) {
          Matter.Render.stop(renderRef.current);
          Matter.Render.run(renderRef.current);
        }

        resetNails();
    
        // 수신한 레벨로 초기화
        setCurrentLevel(data.level);
        currentLevelRef.current = data.level //
        setResetTrigger((prev) => !prev);
      }
    });
  
    return () => {
      socket.off('resetLevel');
    };
  }, []);

  useEffect(() => {
    socket.on('erase', (data: { customId: string; playerId: string }) => {
    //   const body = Matter.Composite.allBodies(engineRef.current.world).find(
    //     (b) => b.label === data.customId
    //   );
    //   if (body) {
    //     Matter.World.remove(engineRef.current.world, body);
    //   }
    // });

      // 1) 월드에 존재하는 모든 바디 조회
      const allBodies = Matter.Composite.allBodies(engineRef.current.world);
    
      // 0) customId가 "nail"로 시작하는지 아닌지 확인
      if(data.customId.startsWith("nail")) {
        // 2) label이 data.customId와 일치하는 Body 찾기
        const targetBody = allBodies.find(b => b.label === data.customId);

        if (targetBody) {
          // 3) 월드에 존재하는 모든 Constraint 조회
          const allConstraints = Matter.Composite.allConstraints(engineRef.current.world);

          // 4) targetBody와 연결된 Constraint( bodyA === targetBody || bodyB === targetBody )를 모두 찾아 제거하고 기존 targetBody들 충돌계수 수정
          const constraintsToRemove = allConstraints.filter(ct => {
            return ct.bodyA === targetBody || ct.bodyB === targetBody;
          });
          console.log("constraintsToRemove.length: ", constraintsToRemove.length)
          // 
          if(constraintsToRemove.length === 0) {
            console.log("constraintsToRemove.length: ", constraintsToRemove.length)
            socket.emit('releaseCategory', {
              playerId: p1,
              currentLevel,
              category: targetBody.collisionFilter.category
            });
          } else { // pin에 연결된 것이 한 개 이상 있을 때
            let isOtherContraintBody = false
            let otherContraintBodyCategory;
            constraintsToRemove.forEach(ct => {
              const otherBody = 
              ct.bodyA === targetBody 
                ? ct.bodyB 
                : ct.bodyA;
  
              if(otherBody) {
                // (A) "constraintsToRemove" 이외의 Constraint 중에서,
                //      otherBody가 연결된 것이 있는지 검사
                const otherConstraints = allConstraints.filter(otherCt => {
                  // 이미 "constraintsToRemove"에 포함된 것 제외
                  if (constraintsToRemove.includes(otherCt)) return false;
  
                  // bodyA나 bodyB가 'otherBody'인지 확인
                  return otherCt.bodyA === otherBody || otherCt.bodyB === otherBody;
                });
                console.log("otherContraints: ", otherConstraints)
                // (B) otherConstraints가 비어 있다면 (= 0개),
                //     즉 "otherBody"가 이외의 다른 Constraint에 연결되지 않았다면
                if (otherConstraints.length === 0) {
                  // => 여기서 collisionFilter 변경
                  otherBody.collisionFilter = {
                    group: 0,
                    category: 0x0001, // 기본값 예시
                    mask: 0xFFFF
                  };
                } else { // "otherBody"가 이외의 다른 Constraint에 연결되어 있다면
                  isOtherContraintBody = true
                }
              }
  
  
              // Constraint 제거
              Matter.World.remove(engineRef.current.world, ct);
            });
            if(!isOtherContraintBody) {
              socket.emit('releaseCategory', {
                playerId: p1,
                currentLevel,
                category: targetBody.collisionFilter.category,
              });
            }
          }

          // 6) 마지막으로 해당 body 자체 제거
          Matter.World.remove(engineRef.current.world, targetBody);

          if(targetBody.label?.startsWith("nail")) {
            removeNail(targetBody);
          }

          console.log(`Body(label='${data.customId}') & all connected constraints removed`);
        }
      } else if(data.customId.startsWith("chain")) {
        console.log("sdfsdfasdfkjaslfdlkadsfjklfdsldsf")
        const constraintsToRemove = Matter.Composite.allConstraints(engineRef.current.world).filter(
          (ct) => ct.label && ct.label.startsWith(data.customId)
        );

        console.log("constraintsToRemove: ", constraintsToRemove);
        
        constraintsToRemove.forEach((ct) => {
          Matter.World.remove(engineRef.current.world, ct);
        }); 
      } else {
        // 2) customId에 해당하는 Body 찾기
        const bodyToRemove = allBodies.find(b => b.label === data.customId);
        if (!bodyToRemove) return;

        // 3) 원본 Body와 연결된 모든 Constraint를 찾는다
        const allConstraints = Matter.Composite.allConstraints(engineRef.current.world);
        const constraintsOfMainBody = allConstraints.filter(ct => {
          return ct.bodyA === bodyToRemove || ct.bodyB === bodyToRemove;
        });

        // 4) 해당 Constraint 제거 & 연결된 nail Body 처리
        constraintsOfMainBody.forEach(constraint => {
          const nail = 
          constraint.bodyA === bodyToRemove 
              ? constraint.bodyB 
              : constraint.bodyA;
          console.log("nail: ", nail?.label);
          const contraintsOfNail = allConstraints.filter(otherCt => {
            if (constraintsOfMainBody.includes(otherCt) || otherCt.label.startsWith("chain")) return false;
            return otherCt.bodyA === nail || otherCt.bodyB === nail;
          });
          console.log("contraintsOfNail: ", contraintsOfNail);
          if(contraintsOfNail.length === 0) {
            console.log("asdfasfdfdsfd")
            const nailToRemove = nail
            if(nailToRemove) {
              console.log("nailToRemove: ", nailToRemove.label);
              const customId = nailToRemove.label;
                // 서버에 삭제 요청 전송
                socket.emit('erase', {
                  customId,
                  playerId: p1,
                  currentLevel
                });
            }
            // Constraint 자체 제거
            Matter.World.remove(engineRef.current.world, constraint);
          } else {
            // Constraint 자체 제거
            Matter.World.remove(engineRef.current.world, constraint);
          }
        });
        // 5) 마지막으로 원본 Body 제거
        Matter.World.remove(engineRef.current.world, bodyToRemove);

        if (bodyToRemove.label?.startsWith("nail")) {
          removeNail(bodyToRemove);
        }
      }
    });
  
    return () => {
      socket.off('erase');
    };
  }, []);

  useEffect(() => {
    socket.on('push', (data: { force: { x: number; y: number }; playerId: string }) => {
      console.log("safdsdf");
      if (ballRef.current && !pushLock) {
        const ball = ballRef.current;
        console.log("data.force: ", data.force);
        Matter.Body.applyForce(ball, ball.position, data.force);
        
        // setPushLock(true);
      }
    });
  
    return () => {
      socket.off('push');
    };
  }, []);

  useEffect(() => {
    socket.on('changeTool', (data: { tool: 'pen' | 'eraser' | 'pin' | 'chain' | 'push'; playerId: string }) => {
      console.log(`Tool changed to: ${data.tool} by player: ${data.playerId}`);
      setTool(data.tool);
    });
  
    return () => {
      socket.off('changeTool');
    };
  }, []);

  useEffect(() => {
    socket.on('changeLevel', (data: { level: number; direction: string; playerId: string }) => {
      console.log(`Level changed to: ${data.level} by player: ${data.playerId}`);
      resetNails();
      setCurrentLevel(data.level); // 레벨 업데이트
      currentLevelRef.current = data.level //
      setGameEnded(false); // 게임 종료 상태 초기화
    });
  
    return () => {
      socket.off('changeLevel');
    };
  }, []);

  useEffect(() => {
    const canvas = cursorCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
  
    let animationFrameId: number | null = null;
  
    const draw = () => {
      // 캔버스를 초기화
      ctx.clearRect(0, 0, canvas.width, canvas.height);
  
      if (cursors.length > 0) {
        // console.log("draw");
        // 모든 커서를 다시 그림
        cursors.forEach(({ x, y, playerId }) => {
          ctx.beginPath();
          ctx.arc(x, y, 5, 0, Math.PI * 2); // 커서 그리기
          ctx.fillStyle = playerId === p2 ? 'blue' : 'red'; // 플레이어별 색상
          ctx.fill();
        });
        // 다음 애니메이션 프레임 요청
        animationFrameId = requestAnimationFrame(draw);
      } else {
        // 애니메이션 종료
        cancelAnimationFrame(animationFrameId!);
        animationFrameId = null;
      }
    };
  
    if (cursors.length > 0) {
      // 애니메이션 시작
      draw();
    }
  
    return () => {
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [cursors]);

  useEffect(() => {
    if (!(currentLevelRef.current === 411 || currentLevelRef.current === 412)) {
      if (!canvasRef.current) return;
      
      // 렌더링 객체 초기화
      if (renderRef.current) {
        Matter.Render.stop(renderRef.current); // 이전 렌더 중지
        // renderRef.current.canvas.remove(); // 기존 캔버스 해제
        renderRef.current = null;
        console.log("렌더링 객체 초기화 완료")
      }

      const render = Matter.Render.create({
        canvas: canvasRef.current,
        engine: engineRef.current,
        options: {
          width: 800,
          height: 600,
          // hasBounds: true,
          // showCollisions: true,
          wireframes: false,
          background: '#f8f4e3',
        },
      });
      console.log("Render.create 완료")
      renderRef.current = render;

      engineRef.current.world.gravity.y = (currentLevel === 6 || currentLevel === 18) ? 0.3 : currentLevel === 13 ? 1 : 0.8;

      // 기존 러너가 있으면 중지
      if (runnerRef.current) {
        Matter.Runner.stop(runnerRef.current);
        runnerRef.current = null;
        console.log("기존 러너 중지 완료")
      }

      // 새로운 러너 생성 및 실행
      const runner = Matter.Runner.create({
        delta: 25,
        isFixed: true, // 고정된 시간 간격 유지
      });
      Matter.Runner.run(runner, engineRef.current);
      runnerRef.current = runner;

      Matter.Render.run(render);

      // 월드 및 레벨 초기화
      const world = engineRef.current.world;

      Matter.World.clear(world, false);
      
      // in your world-init useEffect
      const factory = levelFactories[currentLevel];
      if (factory) {
        const bodies = factory(world);   // ← returns all the bodies you just made
        bodies.forEach(body => {
          if (body.label.startsWith('nail')) {
            addNail(body);               // ← now your nailsRef will contain them
          }
          if (body.label === 'ball') {
            ballRef.current = body;      // ← and you’ll need this too for push/afterUpdate!
            
            initialBallPositionRef.current = {
              x: body.position.x,
              y: body.position.y
            };
          }
        });
      }
    }

    const world = engineRef.current.world;

    if(currentLevelRef.current === 411 || currentLevelRef.current === 412) {
      engineRef1.current.world.gravity.y = 1;
      engineRef2.current.world.gravity.y = 1;
    }

    // if(ballRef.current) {
    //   Matter.Body.applyForce(ballRef.current, ballRef.current.position, {x: 100, y: 0});
    // }
    // 공이 wall_bottom 아래로 떨어졌는지 확인
    const handleCollisionStart = (event: Matter.IEventCollision<Engine>) => {
      console.log('collisionStart event:', event);
      
      // event.pairs가 있는지 확인
      if (!event.pairs) return;

      event.pairs.forEach((pair) => {
        if (
          (pair.bodyA.label === 'ball' && pair.bodyB.label === 'balloon') ||
          (pair.bodyA.label === 'balloon' && pair.bodyB.label === 'ball')
        ) {
          setGameEnded(true);
        } else if (
          (pair.bodyA.label === 'ball' && pair.bodyB.label === 'obstacle') ||
          (pair.bodyA.label === 'obstacle' && pair.bodyB.label === 'ball')
        ) {
          setTimeout(() => {
            if(currentLevelRef.current === 411 || currentLevelRef.current === 412) {
              resetLevel();
            }
          }, 1000)
        }
      });
    }

    const handleAfterUpdate = () => {
      if(currentLevelRef.current === 411 || currentLevelRef.current === 412) {
        const worlds = [engineRef1.current.world, engineRef2.current.world]
        const threshold = 40;

        worlds.map((world) => {
          // 1) 공이 wall_bottom 아래로 떨어지면 리셋
          const wallBottom = Matter.Composite
          .allBodies(world)
          .find(b => b.label === 'wall_bottom');
          if (ballRef.current && wallBottom) {
            if (ballRef.current.position.y > wallBottom.bounds.max.y - threshold) {
              Matter.Body.setPosition(ballRef.current, initialBallPositionRef.current);
              Matter.Body.setVelocity(ballRef.current, { x: 0, y: 0 });
              Matter.Body.setAngularVelocity(ballRef.current, 0);
              Matter.Body.applyForce(ballRef.current, ballRef.current.position, { x: 0, y: 0 });
            }
          }

          // 2) 사용자 그린 객체 opacity 감소 후 제거
          Matter.Composite.allBodies(world).forEach(body => {
            if (!staticObjects.includes(body.label) && !body.isStatic && wallBottom) {
              const touching = Matter.SAT.collides(body, wallBottom)?.collided;
              if (touching) {
                body.render.opacity = body.render.opacity ?? 1;
                body.render.opacity -= 0.01;
                if (body.render.opacity <= 0 && !body.eraserEmitted) {
                  body.eraserEmitted = true;
                  socket.emit('erase', {
                    customId: body.label,
                    playerId: p1,
                    currentLevel: currentLevelRef.current,
                    isFall: true,
                  });
                }
              }
            }
          });
        })
      } else {
        const world = engineRef.current.world;
      
        const canvasHeight = canvasRef.current!.height;
        const threshold = 40;
  
        // ── Stage 6 전용: square_* 만 땅에 닿으면 즉시 제거 ──
        if (currentLevelRef.current === 41 || currentLevelRef.current === 6 || currentLevelRef.current === 48) {
          Matter.Composite.allBodies(world).forEach(body => {
            if (
              body.label.startsWith('square_') &&
              body.position.y > canvasHeight - threshold
            ) {
              Matter.World.remove(world, body);
            }
          });
          return;
        }
  
        // ── 그 외 레벨: 기존 공 리셋 + opacity 감소 로직 ──
  
        // 1) 공이 wall_bottom 아래로 떨어지면 리셋
        const wallBottom = Matter.Composite
          .allBodies(world)
          .find(b => b.label === 'wall_bottom');
        if (ballRef.current && wallBottom) {
          if (ballRef.current.position.y > wallBottom.bounds.max.y - threshold) {
            Matter.Body.setPosition(ballRef.current, initialBallPositionRef.current);
            Matter.Body.setVelocity(ballRef.current, { x: 0, y: 0 });
            Matter.Body.setAngularVelocity(ballRef.current, 0);
            Matter.Body.applyForce(ballRef.current, ballRef.current.position, { x: 0, y: 0 });
          }
        }
  
        // 2) 사용자 그린 객체 opacity 감소 후 제거
        Matter.Composite.allBodies(world).forEach(body => {
          if (!staticObjects.includes(body.label) && !body.isStatic && wallBottom) {
            const touching = Matter.SAT.collides(body, wallBottom)?.collided;
            if (touching) {
              body.render.opacity = body.render.opacity ?? 1;
              body.render.opacity -= 0.01;
              if (body.render.opacity <= 0 && !body.eraserEmitted) {
                body.eraserEmitted = true;
                socket.emit('erase', {
                  customId: body.label,
                  playerId: p1,
                  currentLevel: currentLevelRef.current,
                  isFall: true,
                });
              }
            }
          }
        });
      }
    };

    if (currentLevelRef.current === 411 || currentLevelRef.current === 412) {
      Matter.Events.on(engineRef1.current, 'collisionStart', handleCollisionStart);
      Matter.Events.on(engineRef2.current, 'collisionStart', handleCollisionStart);
    } else {
      Matter.Events.on(engineRef.current, 'collisionStart', handleCollisionStart);
    }
    
    if (currentLevelRef.current === 411 || currentLevelRef.current === 412) {
      Matter.Events.on(engineRef1.current, 'afterUpdate', handleAfterUpdate);
      Matter.Events.on(engineRef2.current, 'afterUpdate', handleAfterUpdate);
    } else {
      Matter.Events.on(engineRef.current, 'afterUpdate', handleAfterUpdate);
    }
    

    // 정리 함수
    return () => {
      if (currentLevelRef.current === 411 || currentLevelRef.current === 412) {
        Matter.Events.off(engineRef1.current, 'collisionStart', handleCollisionStart);
        Matter.Events.off(engineRef2.current, 'collisionStart', handleCollisionStart);
      } else {
        Matter.Events.off(engineRef.current, 'collisionStart', handleCollisionStart);
      }

      if (currentLevelRef.current === 411 || currentLevelRef.current === 412) {
        Matter.Events.off(engineRef.current, 'afterUpdate', handleAfterUpdate);
        Matter.Events.off(engineRef.current, 'afterUpdate', handleAfterUpdate);
      } else {
        Matter.Events.off(engineRef.current, 'afterUpdate', handleAfterUpdate);
      }

      if (currentLevelRef.current === 411 || currentLevelRef.current === 412) {
        if (renderRef1.current) Matter.Render.stop(renderRef1.current);
        if (renderRef2.current) Matter.Render.stop(renderRef2.current);
      } else {
        if (renderRef.current) Matter.Render.stop(renderRef.current);
      }

      if (currentLevelRef.current === 411 || currentLevelRef.current === 412) {
        if (runnerRef1.current) Matter.Runner.stop(runnerRef1.current);
        if (runnerRef2.current) Matter.Runner.stop(runnerRef2.current);
      } else {
        if (runnerRef.current) Matter.Runner.stop(runnerRef.current);
      }
      
      if (currentLevelRef.current === 411 || currentLevelRef.current === 412) {
        Matter.World.clear(engineRef1.current.world, false);
        Matter.World.clear(engineRef2.current.world, false);
      } else {
        Matter.World.clear(world, false);
      }

      if (currentLevelRef.current === 411 || currentLevelRef.current === 412) {
        Matter.Engine.clear(engineRef1.current);
        Matter.Engine.clear(engineRef2.current);
      } else {
        Matter.Engine.clear(engineRef.current);
      }
    }

    // Matter.Runner.run(engineRef.current);
    // Matter.Render.run(render);

    // return () => {
    //   Matter.Render.stop(render);
    //   Matter.World.clear(world, false);
    //   Matter.Engine.clear(engineRef.current);
    // };
  }, [currentLevel, resetTrigger]);

  // 헬퍼 함수: 클릭 좌표와 선분(Constraint의 끝점) 사이의 최단 거리를 계산
  const distancePointToLineSegment = (
    point: { x: number; y: number },
    segA: { x: number; y: number },
    segB: { x: number; y: number }
  ): number => {
    const { x: x0, y: y0 } = point;
    const { x: x1, y: y1 } = segA;
    const { x: x2, y: y2 } = segB;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const segLenSq = dx * dx + dy * dy;
    if (segLenSq === 0) return Math.hypot(x0 - x1, y0 - y1);
    let t = ((x0 - x1) * dx + (y0 - y1) * dy) / segLenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx;
    const cy = y1 + t * dy;
    return Math.hypot(x0 - cx, y0 - cy);
  };

  // 헬퍼 함수: Constraint의 endpoint(월드 좌표)를 반환
  const getConstraintEndpoint = (
    constraint: Matter.Constraint,
    which: "A" | "B"
  ): { x: number; y: number } | null => {
    const body = which === "A" ? constraint.bodyA : constraint.bodyB;
    const pt = which === "A" ? constraint.pointA : constraint.pointB;
    if (body) {
      return { x: body.position.x + (pt?.x || 0), y: body.position.y + (pt?.y || 0) };
    } else if (pt) {
      return { x: pt.x, y: pt.y };
    }
    return null;
  };

  // 헬퍼 함수: 클릭 좌표(mousePos) 근처(임계값 이하)에 위치하면서 label이 "chain"으로 시작하는 Constraint 반환
  const getChainConstraintsNearPoint = (
    mousePos: { x: number; y: number },
    world: Matter.World,
    threshold: number = 5
  ): Matter.Constraint[] => {
    const allConstraints = Matter.Composite.allConstraints(world);
    return allConstraints.filter(constraint => {
      // 반드시 constraint의 label이 "chain"으로 시작해야 함
      if (!constraint.label || !constraint.label.startsWith("chain")) return false;

      const pA = getConstraintEndpoint(constraint, "A");
      const pB = getConstraintEndpoint(constraint, "B");
      if (!pA || !pB) return false;
      const dist = distancePointToLineSegment(mousePos, pA, pB);
      return dist <= threshold;
    });
  };

  /** ── 1) createPhysicsBody 함수 전체 ── **/
const createPhysicsBody = (
  points: Matter.Vector[],
  myGenerated: boolean,
  collisionCategory: number,
  groupNumber: number,
  customId?: string
) => {
  // ── Stage 6: 무조건 80×80 사각형만 ──
  if (currentLevelRef.current === 41 || currentLevelRef.current === 6 || currentLevelRef.current === 8) {
    // drawPoints 가 비어 있으면 캔버스 중앙
    const cx = points.length
      ? points.reduce((sum, p) => sum + p.x, 0) / points.length
      : canvasRef.current!.width / 2;
    const cy = points.length
      ? points.reduce((sum, p) => sum + p.y, 0) / points.length
      : canvasRef.current!.height / 2;

    const square = Matter.Bodies.rectangle(cx, cy, 80, 80, {
      render: {
        fillStyle: 'rgba(0,0,0,0)',
        strokeStyle: '#1d4ed8',
        lineWidth: 1,
      },
      isStatic: false,
      label: customId || `square_${Date.now()}`,
      collisionFilter: {
        group: groupNumber,
        category: collisionCategory,
        mask:
          collisionCategory === 0x0001
            ? 0xFFFF
            : (0xFFFF & ~collisionCategory),
      },
    });
    return { body: square, nailsInShape: [] };
  }

  // ── 그 외 레벨: polygon 생성 로직 ──
  if (points.length < 3) return null;

  // 1) 간소화
  const simplified = points.filter((pt, i) => {
    if (i === 0 || i === points.length - 1) return true;
    const prev = points[i - 1];
    return Math.hypot(pt.x - prev.x, pt.y - prev.y) > 2;
  });

  // 2) nail 검출
  const nailsInShape = nailsRef.current.filter(nail =>
    Matter.Bounds.overlaps(
      Matter.Bounds.create(simplified),
      nail.bounds
    )
  );

  

  // 3) 핀 모드일 땐 nail body 반환
  if (tool === 'pin') {
    const cx = simplified.reduce((s, p) => s + p.x, 0) / simplified.length;
    const cy = simplified.reduce((s, p) => s + p.y, 0) / simplified.length;
    const radius = Math.max(
      ...simplified.map(p => Math.hypot(p.x - cx, p.y - cy))
    );
    const targetBody = Matter.Composite.allBodies(engineRef.current.world)
      .find(b => Matter.Bounds.contains(b.bounds, { x: cx, y: cy }));
    if (!targetBody) return null;

    const nail = Matter.Bodies.circle(cx, cy, radius, {
      isStatic: targetBody.isStatic,
      render: {
        fillStyle: 'rgba(0,0,0,0)',
        strokeStyle: '#ef4444',
        lineWidth: 2,
      },
      label: customId || `nail_${Date.now()}`,
    });
    // 서버 전송은 handleMouseUp 에서 처리
    return nail;
  }

  // 4) polygon body 생성
  const centroidX = simplified.reduce((s, v) => s + v.x, 0) / simplified.length;
  const centroidY = simplified.reduce((s, v) => s + v.y, 0) / simplified.length;
  const verts = simplified.map(v => ({
    x: v.x - centroidX,
    y: v.y - centroidY,
  }));
  const bodyOptions = {
    render: {
      fillStyle: 'rgba(0,0,0,0)',
      strokeStyle: '#1d4ed8',
      lineWidth: 1,
    },
    isStatic: false,
    friction: 0.8,
    restitution: 0.2,
    density: 0.005,
    frictionAir: 0.02,
    label: customId || `custom_${Date.now()}`,
    collisionFilter: {
      group: groupNumber,
      category: collisionCategory,
      mask:
        collisionCategory === 0x0001
          ? 0xFFFF
          : (0xFFFF & ~collisionCategory),
    },
  };
  const body = Matter.Bodies.fromVertices(
    centroidX,
    centroidY,
    [verts],
    bodyOptions
  );

    if (currentLevelRef.current === 10 && nailsInShape.length > 0) {
    const nail = nailsInShape[0];

    body.collisionFilter = {
      category: nail.collisionFilter.category, // nail과 같은 카테고리(0x0002)
      mask: 0x0001,                            // 공하고만 충돌
      group: nail.collisionFilter.group,       // nail과 같은 그룹(충돌 안함)
    };
  }
    // body 생성 직후
  if (nailsInShape.length > 0) {
  const nf        = nailsInShape[0].collisionFilter;
  const nailGroup = nf.group    ?? 0;
  const nailCat   = nf.category ?? 0x0001;
  const nailMask  = nf.mask     ?? nailCat;

  body.collisionFilter.group    = nailGroup;
  body.collisionFilter.category = nailCat;
  // nail 카테고리를 포함해 주면 body ↔ nail 이 충돌하면서도 constraint 로 묶여 있게 됩니다.
  body.collisionFilter.mask     = nailMask | nailCat;
  }


  return { body, nailsInShape };
};


  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    let rect;
    if(currentLevelRef.current === 411) {
      if(!canvasRef1.current) return;
      rect = canvasRef1.current.getBoundingClientRect();
    } else if(currentLevelRef.current === 412) {
      if(!canvasRef2.current) return;
      rect = canvasRef2.current.getBoundingClientRect();
    } else {
      if(!canvasRef.current) return;
      rect = canvasRef.current.getBoundingClientRect();
    }

    const point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    
    if (tool === 'chain') {
      // 클릭 위치에 있는 Body 중 label이 'nail'로 시작하는 것만 찾음
      const bodies = Matter.Query.point(
        Matter.Composite.allBodies(engineRef.current.world),
        point
      );
      const pin = bodies.find(body => body.label.startsWith('nail'));

      if (pin) {
        setSelectedPins(prevPins => {
          // 같은 pin이 이미 포함되었으면 추가하지 않음
          if (prevPins.includes(pin)) return [...prevPins];
          const newPins = [...prevPins, pin];

          // 만약 두 개의 핀이 선택되면 체인 생성
          if (newPins.length === 2) {
            // 만약 이미 chain emit이 이루어진 상태라면 반환 (중복 방지)
            if (chainEmittedRef.current) {
              return [];
            }
            const [pinA, pinB] = newPins;

            // 임의의 customId 부여 (예: chain_타임스탬프)
            const customId = `chain_${Date.now()}`;
            socket.emit('createChain', {
              playerId: p1,
              customId,
              pinAId: pinA.label, // 예: 'nail_123'
              pinBId: pinB.label, // 예: 'nail_456'
              stiffness: 0.0001,
              damping: 0.00001,
              length: Matter.Vector.magnitude(
                Matter.Vector.sub(pinB.position, pinA.position)
              ) * 1.1,
              currentLevel,
            });

            socket.emit('changeTurn', { nextPlayerId: p2, currentLevel });
            
            // 체인 생성 이벤트가 한 번 실행된 것으로 플래그 설정
            chainEmittedRef.current = true;

            // Optional: 일정 시간 후 다시 초기화 (예: 500ms 후)
            setTimeout(() => {
              chainEmittedRef.current = false;
            }, 500);

            // 선택한 핀 상태 초기화
            return [];
          }
          return newPins;
        });
      }
      return;
    }

    if (tool === 'eraser') {
      if (currentTurn === p2) return;
    
      // 1) 클릭 지점에 있는 모든 Body 조회
      const mousePosition = { x: point.x, y: point.y };
      const bodiesAtPoint = Matter.Query.point(
        Matter.Composite.allBodies(engineRef.current.world),
        mousePosition
      );
    
      // 2) “지울 수 있는” Body만 남기기  
      //    - isStatic true → 맵 구조물(벽, 타워, 별, 피벗 등) 자동 보호  
      //    - staticObjects.includes(label) → ball, balloon 등 시작 시 존재하는 동적 오브젝트 보호  
      const erodable = bodiesAtPoint.filter(body =>
        !body.isStatic &&
        !staticObjects.includes(body.label)
      );
    
      // 3) 못(nail) 지우기
      const nailBodies = erodable.filter(b => b.label.startsWith('nail'));
      if (nailBodies.length > 0) {
        const customId = nailBodies[0].label!;
        socket.emit('erase', {
          customId,
          playerId: p2,
          currentLevel,
          isFall: false,
        });
        socket.emit('changeTurn', { nextPlayerId: p2, currentLevel });
        return;
      }
    
      // 4) 체인 지우기
      const nearChains = getChainConstraintsNearPoint(
        mousePosition,
        engineRef.current.world,
        5
      );
      if (nearChains.length > 0) {
        const customId = nearChains[0].label!;
        if (customId.startsWith('chain')) {
          socket.emit('erase', {
            customId,
            playerId: p1,
            currentLevel,
            isRelease: false,
          });
          socket.emit('changeTurn', { nextPlayerId: p2, currentLevel });
        }
        return;
      }
    
      // 5) 그 외 지우기: erodable 에 남은 것만
      for (const body of erodable) {
        const customId = body.label!;
        socket.emit('erase', {
          customId,
          playerId: p1,
          currentLevel,
        });
        socket.emit('changeTurn', { nextPlayerId: p2, currentLevel });
        break;
      }
    
      return;
    }
    
    console.log("pushLock: ", pushLock);

    // if (tool === 'push' && ballRef.current && !pushLock) {
    if (tool === 'push' && ballRef.current) {
      // push 남용 방지
      // setPushLock(true);
      if(currentTurn === p2) return;
      
      const logInfo: LogInfo = {
        player_number: currentTurn === p2 ? 1 : 2,
        type: 'push',
        timestamp: new Date(),
      };
      // saveLog(logInfo);

      // 턴 전환 로직
      // setCurrentTurn((prevTurn) => (prevTurn === "player1" ? "player2" : "player1"));

      const ball = ballRef.current;
      const ballX = ball.position.x;

      // 공의 중심에서 클릭한 위치까지의 거리 계산
      const clickOffsetX = point.x - ballX;

      let force = clickOffsetX < 0 ? { x: 0.008, y: 0 } : { x: -0.008, y: 0 };
      if(currentLevelRef.current === 419) {
        force = clickOffsetX < 0 ? { x: 0.06, y: 0 } : { x: -0.06, y: 0 };
      }

      // 서버에 힘 적용 요청 전송
      socket.emit('push', {
        force,
        playerId: p1,
        currentLevel
      });
    }

    if(currentTurn === p1) {
      setIsDrawing(true);
      setDrawPoints([point]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    let rect;
    if(currentLevelRef.current === 411) {
      if(!canvasRef1.current) return;
      rect = canvasRef1.current.getBoundingClientRect();
    } else if(currentLevelRef.current === 412) {
      if(!canvasRef2.current) return;
      rect = canvasRef2.current.getBoundingClientRect();
    } else {
      if(!canvasRef.current) return;
      rect = canvasRef.current.getBoundingClientRect();
    }
  
    let point = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
    console.log("point: ", point);

    // 서버로 마우스 위치 전송
    socket.emit('mouseMove', { x: point.x, y: point.y, playerId: p1 });

    if(!isDrawing || tool === 'eraser') return;

    // 캔버스 경계 안에 point를 제한
    point = {
      x: Math.max(0, Math.min(point.x, rect.width)), 
      y: Math.max(0, Math.min(point.y, rect.height)), 
    };
  
    // 벽과의 충돌 감지
    const bodies = currentLevelRef.current === 411 ? Matter.Query.point(Matter.Composite.allBodies(engineRef1.current.world), point) : currentLevelRef.current === 412 ? Matter.Query.point(Matter.Composite.allBodies(engineRef2.current.world), point) : Matter.Query.point(Matter.Composite.allBodies(engineRef.current.world), point)
    const collidedWall = bodies.find(body => body.label === 'wall');
    // console.log("collidedWall: ", collidedWall)
  
    if (collidedWall) {
      // 충돌한 벽의 경계 찾기
      const bounds = collidedWall.bounds;
  
      // 벽의 각 변과 점 사이의 거리 계산
      const distances = [
        Math.abs(point.x - bounds.min.x), // 왼쪽 변
        Math.abs(point.x - bounds.max.x), // 오른쪽 변
        Math.abs(point.y - bounds.min.y), // 위쪽 변
        Math.abs(point.y - bounds.max.y), // 아래쪽 변
      ];
  
      // 가장 가까운 변 찾기
      const minDistance = Math.min(...distances);
      // console.log("minDistance: ", minDistance)
      const threshold = 5; // 벽과의 거리 임계값
  
      if (minDistance < threshold) {
      if (distances[0] === minDistance) point.x = bounds.min.x; // 왼쪽 변
      else if (distances[1] === minDistance) point.x = bounds.max.x; // 오른쪽 변
      else if (distances[2] === minDistance) point.y = bounds.min.y; // 위쪽 변
      else if (distances[3] === minDistance) point.y = bounds.max.y; // 아래쪽 변
      }
    }
  
    const lastPoint = drawPoints[drawPoints.length - 1];
    // console.log("lastPoint: ", lastPoint)
    const dist = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
  
    if (dist > 5) {
      setDrawPoints(prev => [...prev, point]);
    }
  };
  const handleMouseUp = () => {
    if (!isDrawing) {
    setDrawPoints([]);
    return;
  }
  // ── 1) 핀 툴 전용 처리 ──
  if (tool === 'pin' && currentTurn === p1) {
    if (drawPoints.length < 2) {
      setIsDrawing(false);
      setDrawPoints([]);
      return;
    }

    // 중심과 반지름 계산
    const cx = drawPoints.reduce((sum, p) => sum + p.x, 0) / drawPoints.length;
    const cy = drawPoints.reduce((sum, p) => sum + p.y, 0) / drawPoints.length;
    const radius = Math.max(
      ...drawPoints.map(p => Math.hypot(p.x - cx, p.y - cy))
    );

    // 1) 로컬에 nail 한 번만 추가
    const customId = `nail_${Date.now()}`;
    const nail = Matter.Bodies.circle(cx, cy, radius, {
      isStatic: false,
      collisionFilter: { group: 0, category: 0x0100, mask: 0xFFFF },
      render: { fillStyle: 'rgba(0,0,0,0)', strokeStyle: '#ef4444', lineWidth: 2 },
      label: customId,
    });
    // Matter.World.add(engineRef.current.world, nail);
    // addNail(nail);

    // 2) 서버에 drawPin 이벤트 전송
    socket.emit('drawPin', {
      customId,
      centerX: cx,
      centerY: cy,
      radius,
      category: nail.collisionFilter.category,
      groupNumber: nail.collisionFilter.group,
      playerId: p1,
      currentLevel,
    });
    socket.emit('changeTurn', { nextPlayerId: p2, currentLevel });

    // 상태 초기화
    setIsDrawing(false);
    setDrawPoints([]);
    return;
  }

  // ── 2) 펜 툴 전용 처리 ──
  if (tool === 'pen' && currentTurn === p1) {
    // Level 6/18 전용: 80×80 사각형만
    if (currentLevel === 6 || currentLevel === 18 || currentLevelRef.current === 41 || currentLevelRef.current === 48) {
      const cx = drawPoints.length
        ? drawPoints.reduce((sum, p) => sum + p.x, 0) / drawPoints.length
        : canvasRef.current!.width / 2;
      const cy = drawPoints.length
        ? drawPoints.reduce((sum, p) => sum + p.y, 0) / drawPoints.length
        : canvasRef.current!.height / 2;
      const customId = `square_${Date.now()}`;

      const square = Matter.Bodies.rectangle(cx, cy, 80, 80, {
        render: {
          fillStyle: 'rgba(0,0,0,0)',
          strokeStyle: '#1d4ed8',
          lineWidth: 1,
        },
        collisionFilter: { group: 0, category: 0x0001, mask: 0xFFFF },
        label: customId,
      });
      Matter.World.add(engineRef.current.world, square);

      socket.emit('drawShape', {
        playerId: p1,
        customId,
        currentLevel: 6,
        collisionCategory: square.collisionFilter.category,
        groupNumber: square.collisionFilter.group,
        centerX: cx,
        centerY: cy,
      });
      socket.emit('changeTurn', { nextPlayerId: p2, currentLevel });

      setIsDrawing(false);
      setDrawPoints([]);
      return;
    }

    // 일반 레벨: 다각형 생성
    const result = createPhysicsBody(drawPoints, true, 0x0001, 0);
    if (result && 'body' in result) {
      const { body, nailsInShape } = result;

      // 로컬 추가
      Matter.World.add(engineRef.current.world, body);

      // 붙어 있던 nail들과 constraint 연결
      nailsInShape.forEach(nail => {
        const ct = Matter.Constraint.create({
          bodyA: body,
          pointA: {
            x: nail.position.x - body.position.x,
            y: nail.position.y - body.position.y,
          },
          bodyB: nail,
          pointB: { x: 0, y: 0 },
          stiffness: 1,
          length: 0,
          render: { visible: false },
          collideConnected: false,
        });
        Matter.World.add(engineRef.current.world, ct);
      });

      // 서버에 drawShape 이벤트 전송
      socket.emit('drawShape', {
        playerId: p1,
        customId: body.label,
        currentLevel,
        collisionCategory: body.collisionFilter.category,
        groupNumber: body.collisionFilter.group,
        points: drawPoints,
      });
      socket.emit('changeTurn', { nextPlayerId: p2, currentLevel });
    }

    setIsDrawing(false);
    setDrawPoints([]);
    return;
  }

  // ── 3) 그 외 도구(eraser, chain, push 등) 처리 완료 후 상태만 초기화 ──
  setIsDrawing(false);
  setDrawPoints([]);
};




  const handleToolChange = (newTool: 'pen' | 'eraser' | 'pin' | 'chain' | 'push') => {
    if (currentTurn === p2) return;
    setTool(newTool);
    setIsDrawing(false);
    setDrawPoints([]);

    // Clear the selected pins
    setSelectedPins([]);

    // 서버로 tool 변경 전송
    socket.emit('changeTool', { tool: newTool, playerId: p1, currentLevel });
  };

  // const handleLevelChange = (direction: 'prev' | 'next') => {
  //   setCurrentLevel(prev => direction === 'next' ? prev + 1 : Math.max(1, prev - 1));
  // };
  const handleLevelChange = (direction: 'prev' | 'next') => {
    if (direction === 'next') {
      if (currentLevel < TOTAL_LEVELS) {
        const newLevel = currentLevel + 1;
        // setCurrentLevel(prev => prev + 1);
        // setGameEnded(false); // 게임 종료 상태 초기화

        const logInfo: LogInfo = {
          player_number: currentTurn === p2 ? 1 : 2,
          type: 'move_next_level',
          timestamp: new Date(),
        };
        // saveLog(logInfo)
        
        // 서버로 레벨 변경 전송
        socket.emit('changeLevel', { level: newLevel, currentLevel, direction, playerId: p1 });
      } else {
        // showTemporaryMessage("실험이 마지막 스테이지입니다");
      }
    } else {
      if (currentLevel > 1) {
        const newLevel = currentLevel - 1;
        // setCurrentLevel(prev => prev - 1);
        
        const logInfo: LogInfo = {
          player_number: currentTurn === p2 ? 1 : 2,
          type: 'move_prev_level',
          timestamp: new Date(),
        };
        // saveLog(logInfo)
        
        // 서버로 레벨 변경 전송
        socket.emit('changeLevel', { type: 'move_prev_level', level: newLevel, direction, playerId: p1, currentLevel, newLevel });
      } else {
        // showTemporaryMessage("첫 스테이지입니다");
      }
    }
  };

  const handleNextLevel = () => {
    if (currentLevel < TOTAL_LEVELS) {
      const newLevel = currentLevel + 1
      // setCurrentLevel((prevLevel) => prevLevel + 1)
      setGameEnded(false); // 게임 종료 상태 초기화

      // 서버로 레벨 변경 전송
      socket.emit('changeLevel', { level: newLevel, playerId: p1 });
    } else {
      // setCurrentLevel((prevLevel) => prevLevel)
      setGameEnded(false); // 게임 종료 상태 초기화
    }
  }

  const resetLevel = () => {
    const logInfo: LogInfo = {
      player_number: currentTurn === p2 ? 1 : 2,
      type: 'refresh',
      timestamp: new Date(),
    };
    // saveLog(logInfo);

    // 서버로 초기화 이벤트 전송
    socket.emit('resetLevel', { playerId: p1, level: currentLevel });
  };



  // 누적해서 csv 파일 업데이트
  const saveLog = async (logInfo: LogInfo) => {
    try {
      console.log("ddd: ", {
        player_number: logInfo.player_number,
        type: logInfo.type,
        timestamp: logInfo.timestamp.toISOString(), // Convert timestamp to ISO format
      })
      await axios.post('http://localhost:3000/logger/log', {
        player_number: logInfo.player_number,
        type: logInfo.type,
        timestamp: logInfo.timestamp.toISOString(), // Convert timestamp to ISO format
      });
      console.log('Log saved successfully');
    } catch (error) {
      console.error('Failed to save log:', error);
    }
  }

  const drawOtherPlayerCursor = (x: number, y: number, playerId: string) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2); // 커서 그리기
    ctx.fillStyle = playerId === p1 ? 'blue' : 'red'; // 플레이어에 따라 색상 다르게
    ctx.fill();
  };
  
  const handleButtonClick = () => {
    console.log('Current cursors length:', cursors.length);
  };

  const handleShowBodies = () => {
    if (!engineRef.current) return;
    const allBodies = Matter.Composite.allBodies(engineRef.current.world);
    console.log("All Bodies:", allBodies);
  };

  return (
      <div className="flex flex-col items-center gap-4">
        {/* <Timer startTimer={startTimer} onFinish={handleTimerFinish} /> */}
        {/* 스테이지 상태 (1 ~ 10까지 예시) */}
        {/* 스테이지 상태 */}
      <div className="mt-4 p-4 border border-gray-300 rounded overflow-x-auto">
        <h3 className="text-lg font-bold mb-2">스테이지 상태</h3>
        <div className="flex flex-col gap-4">
          
          {/* 1~10 */}
          <table className="min-w-full table-auto border-collapse">
            <thead>
              <tr>
                <th className="border p-2">스테이지</th>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(level => (
                  <th key={level} className="border p-2 text-center">{level}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="border p-2">상태</th>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(level => {
                  const isCleared = completedLevels.includes(level);
                  return (
                    <td
                      key={level}
                      className={`border p-2 text-center font-bold text-white ${isCleared ? 'bg-green-500' : 'bg-red-500'}`}
                    >
                      {isCleared ? '완료' : '미완료'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>

          {/* 11~20 */}
          <table className="min-w-full table-auto border-collapse">
            <thead>
              <tr>
                <th className="border p-2">스테이지</th>
                {Array.from({ length: 10 }, (_, i) => i + 11).map(level => (
                  <th key={level} className="border p-2 text-center">{level}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th className="border p-2">상태</th>
                {Array.from({ length: 10 }, (_, i) => i + 11).map(level => {
                  const isCleared = completedLevels.includes(level);
                  return (
                    <td
                      key={level}
                      className={`border p-2 text-center font-bold text-white ${isCleared ? 'bg-green-500' : 'bg-red-500'}`}
                    >
                      {isCleared ? '완료' : '미완료'}
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>

        </div>
      </div>

        <div className="flex gap-4 mb-4">
          {/* <div>
            <button onClick={handleButtonClick}>Show Cursors Length</button>
          </div> */}
          <button onClick={handleShowBodies}>Show All Bodies</button>
          <button
            onClick={() => resetLevel()}
            className={`p-2 rounded 'bg-gray-200'`}
          >
            <RefreshCw size={24} />
          </button>
          <button
            onClick={() => handleToolChange('pen')}
            className={`p-2 rounded ${
              tool === 'pen' ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            <Pen size={24} />
          </button>
          <button
            onClick={() => handleToolChange('eraser')}
            className={`p-2 rounded ${
              tool === 'eraser' ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            <Eraser size={24} />
          </button>
          <button
            onClick={() => handleToolChange('pin')}
            className={`p-2 rounded ${
              tool === 'pin' ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            <Pin size={24} />
          </button>
          {/* <button
            onClick={() => handleToolChange('chain')}
            className={`p-2 rounded ${
              tool === 'chain' ? 'bg-blue-500 text-white' : 'bg-gray-200'
            }`}
          >
            <Link size={24} />
          </button> */}
          {/* 밀기 도구 버튼 */}
          <button
            onClick={() => handleToolChange('push')}
            className={`p-2 rounded relative ${tool === 'push' ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              overflow: 'hidden'
            }}
          >
            {/* 공을 뒤에 배치 */}
            <Circle size={20} style={{ position: 'absolute', left: '6px', zIndex: 1 }} />
            {/* 손이 약간 겹치도록 배치 */}
            <Hand size={22} style={{ position: 'relative', left: '8px', zIndex: 2, transform: 'rotate(-20deg)' }} />
          </button>
          {currentLevelRef.current === 41 ? <button onClick={() => resetLevel()}>지렛대 중심 위치 재설정(누를 시 맵도 초기화 됨)</button> : ''}
        </div>

        <div className="flex items-center justify-between gap-4">
          <h2
            className={`text-lg font-bold ${
              currentTurn === 'player1' ? 'text-blue-500' : 'text-red-500'
            }`}
          >
            {currentTurn === 'player1' ? "플레이어1 차례" : "플레이어2 차례"}
          </h2>
        </div>
        
        <div className="relative">
            {currentLevelRef.current === 411 || currentLevelRef.current === 412 ? (
            <div className="flex flex-col gap-2">
              {/* 윗쪽 캔버스 */}
              <div className="relative">
                <canvas ref={canvasRef1} width={400} height={300} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} className="mb-2 border border-gray-300 rounded-lg shadow-lg" />
                {currentLevelRef.current === 412 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40 pointer-events-none">
                    <span className="text-white text-2xl font-bold">조작 불가능</span>
                  </div>
                )}
              </div>
              {/* 아랫쪽 캔버스 */}
              <div className="relative">
                <canvas ref={canvasRef2} width={400} height={300} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} className="border border-gray-300 rounded-lg shadow-lg" />
                {currentLevelRef.current === 411 && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-40 pointer-events-none">
                    <span className="text-white text-2xl font-bold">조작 불가능</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              width={800}
              height={600}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className="border border-gray-300 rounded-lg shadow-lg"
              style={{ cursor: tool === 'eraser' ? 'crosshair' : 'default' }}
            />
          )}
          
          {/* 커서를 표시하는 별도의 캔버스 */}
          <canvas
            ref={cursorCanvasRef}
            width={800}
            height={600}
            className="absolute top-0 left-0 border border-transparent pointer-events-none"
            style={{
              zIndex: 10, // 게임 캔버스 위에 렌더링
            }}
          />
          
          {isDrawing && tool === 'pen' && (
            <svg
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: 'none',
              }}
              width={800}
              height={600}
            >
              <path
                d={`M ${drawPoints.map(p => `${p.x},${p.y}`).join(' L ')}`}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="2"
                strokeDasharray="4"
              />
            </svg>
          )}

          {gameEnded && (
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-50">
              <div className="bg-white p-8 rounded-lg shadow-xl">
                <h2 className="text-3xl font-bold text-center mb-4">레벨 클리어!</h2>
                <button
                  onClick={() => handleNextLevel()}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  {currentLevel < TOTAL_LEVELS ? '다음 레벨로 이동' : '확인'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-4">
          <button
            onClick={() => handleLevelChange('prev')}
            disabled={currentLevel === 1}
            className="p-2 rounded bg-gray-200 disabled:opacity-50"
          >
            <ChevronLeft size={24} />
          </button>
          <span className="py-2 px-4 bg-gray-100 rounded">스테이지 {currentLevel}</span>
          <button
            onClick={() => handleLevelChange('next')}
            disabled={currentLevel === TOTAL_LEVELS}
            className="p-2 rounded bg-gray-200 disabled:opacity-50"
          >
            <ChevronRight size={24} />
          </button>
        </div>
      </div>
      // )}
    // </div>
  );
};

export default PhysicsCanvas;